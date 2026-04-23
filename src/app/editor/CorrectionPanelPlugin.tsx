/**
 * CorrectionPanelPlugin — floating correction panel inside the Lexical editor.
 *
 * Opens when useCorrectionStore.isOpen is true. Loads suggestions from three
 * sources progressively: the local corrections YAML file (immediate), then
 * knowledge_find_entities and knowledge_search_passages via MCP (async).
 *
 * On confirm, writes a same_as entry to .liminis/knowledge-corrections.yaml
 * and calls knowledge_apply_corrections to sync the knowledge graph.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isTextNode } from 'lexical';
import { toast } from 'sonner';
import { useCorrectionStore } from '../../../renderer/stores/correctionStore';
import {
  parseCorrectionsYaml,
  serializeCorrectionsYaml,
  mergeCorrection,
  isExistingCanonical,
  type CorrectionEntry,
} from './correction-yaml';

// --- Style helpers ---

const isDark = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

const panelStyle = (): React.CSSProperties => {
  const dark = isDark();
  return {
    position: 'fixed',
    zIndex: 10001,
    borderRadius: '8px',
    padding: '12px',
    minWidth: '280px',
    maxWidth: '360px',
    background: `var(--vscode-menu-background, ${dark ? '#252526' : '#ffffff'})`,
    border: `1px solid var(--vscode-menu-border, ${dark ? '#454545' : '#d4d4d4'})`,
    boxShadow: dark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.15)',
    color: `var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'})`,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
  };
};

// --- MCP result parsing ---

interface RawEntity {
  name?: string;
  uuid?: string;
}

interface RawPassage {
  name?: string;
  content?: string;
}

function parseMcpNames(result: unknown, key: string): string[] {
  try {
    let data: unknown = result;
    if (typeof result === 'string') data = JSON.parse(result);
    let arr: unknown[] = [];
    if (Array.isArray(data)) {
      arr = data;
    } else if (data && typeof data === 'object') {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) arr = value;
    }
    return arr
      .map((item) => (item as RawEntity | RawPassage).name ?? '')
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

// --- Main component ---

export function CorrectionPanelPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { isOpen, position, selectedText } = useCorrectionStore();

  const panelRef = useRef<HTMLDivElement>(null);
  const yamlEntriesRef = useRef<CorrectionEntry[]>([]);

  const [yamlSuggestions, setYamlSuggestions] = useState<string[]>([]);
  const [entitySuggestions, setEntitySuggestions] = useState<string[]>([]);
  const [passageSuggestions, setPassageSuggestions] = useState<string[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [loadingPassages, setLoadingPassages] = useState(false);
  const [canonicalInput, setCanonicalInput] = useState('');
  const [replaceAll, setReplaceAll] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'needs-canonical-warning'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = useCallback(() => {
    useCorrectionStore.getState().close();
  }, []);

  // Reset state when panel opens
  useEffect(() => {
    if (!isOpen) return;
    setYamlSuggestions([]);
    setEntitySuggestions([]);
    setPassageSuggestions([]);
    setCanonicalInput('');
    setReplaceAll(false);
    setConfirmPhase('idle');
    setIsSubmitting(false);
    yamlEntriesRef.current = [];
  }, [isOpen]);

  // Outside-click and Escape dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handleMousedown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', handleMousedown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMousedown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, close]);

  // Load suggestions when panel opens
  useEffect(() => {
    if (!isOpen || !selectedText) return;

    let cancelled = false;

    // Load YAML suggestions synchronously after file read
    const loadYaml = async () => {
      try {
        const result = await window.api.fs.readFile('.liminis/knowledge-corrections.yaml');
        if (cancelled) return;
        const entries = parseCorrectionsYaml(result?.content ?? null);
        yamlEntriesRef.current = entries;
        const matches = entries
          .filter((e) => e.type === 'same_as' && e.aliases.includes(selectedText))
          .map((e) => e.canonical);
        setYamlSuggestions(matches);
      } catch {
        // File may not exist yet — that's fine
        yamlEntriesRef.current = [];
      }
    };

    // Load entity suggestions via MCP
    const loadEntities = async () => {
      setLoadingEntities(true);
      try {
        const res = await window.api.mcp.callTool('knowledge-reader', 'knowledge_find_entities', {
          query: selectedText,
          num_results: 5,
        });
        if (cancelled) return;
        if (res.success && res.result) {
          const names = parseMcpNames(res.result, 'nodes');
          setEntitySuggestions(names);
        }
      } catch {
        // Knowledge graph unavailable — silent, not required for panel function
      } finally {
        if (!cancelled) setLoadingEntities(false);
      }
    };

    // Load passage suggestions via MCP
    const loadPassages = async () => {
      setLoadingPassages(true);
      try {
        const res = await window.api.mcp.callTool(
          'knowledge-reader',
          'knowledge_search_passages',
          {
            query: selectedText,
            num_results: 5,
            min_score: 0.3,
          }
        );
        if (cancelled) return;
        if (res.success && res.result) {
          const names = parseMcpNames(res.result, 'passages');
          setPassageSuggestions(names);
        }
      } catch {
        // Knowledge graph unavailable — silent
      } finally {
        if (!cancelled) setLoadingPassages(false);
      }
    };

    // The MCP stdio invoker rejects concurrent calls to the same server (ADR-042).
    // Serialize the two knowledge-reader calls while keeping YAML loading concurrent.
    const loadKnowledgeSuggestions = async () => {
      await loadEntities();
      if (cancelled) return;
      await loadPassages();
    };

    void loadYaml();
    void loadKnowledgeSuggestions();

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedText]);

  // Deduplicate suggestions across sources (case-insensitive), preserving order
  const allSuggestions = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...yamlSuggestions, ...entitySuggestions, ...passageSuggestions]) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
    }
    return out;
  })();

  const handleConfirm = useCallback(async () => {
    const canonical = canonicalInput.trim();
    if (!canonical) return;

    // R13: warn if selectedText is an existing canonical name
    if (confirmPhase === 'idle' && isExistingCanonical(yamlEntriesRef.current, selectedText)) {
      setConfirmPhase('needs-canonical-warning');
      return;
    }

    setIsSubmitting(true);

    try {
      // (a) Replace all occurrences in the document if requested
      if (replaceAll) {
        editor.update(() => {
          const root = $getRoot();
          const collectTextNodes = (node: ReturnType<typeof $getRoot>): void => {
            if ($isTextNode(node)) {
              const content = node.getTextContent();
              if (content.includes(selectedText)) {
                node.setTextContent(content.replaceAll(selectedText, canonical));
              }
              return;
            }
            if ('getChildren' in node && typeof node.getChildren === 'function') {
              for (const child of (node as { getChildren: () => ReturnType<typeof $getRoot>[] }).getChildren()) {
                collectTextNodes(child);
              }
            }
          };
          collectTextNodes(root);
        });
      }

      // (b) Ensure .liminis/ directory exists
      try {
        await window.api.fs.mkdir('.liminis');
      } catch {
        // May fail if it already exists on some platforms — that's fine
      }

      // (c) Merge and write YAML atomically
      const updated = mergeCorrection(yamlEntriesRef.current, selectedText, canonical);
      const yaml = serializeCorrectionsYaml(updated);
      await window.api.fs.writeFile('.liminis/knowledge-corrections.yaml', yaml, 'atomic');
    } catch (err) {
      toast.error('Failed to save correction', {
        description: err instanceof Error ? err.message : String(err),
      });
      setIsSubmitting(false);
      return;
    }

    // (d) Apply corrections — isolated so a KG failure never blocks panel close
    try {
      const mcpRes = await window.api.mcp.callTool(
        'knowledge-writer',
        'knowledge_apply_corrections',
        {}
      );
      if (!mcpRes.success) {
        toast.error('Knowledge graph sync failed', {
          description:
            'The correction was saved. It will be applied on the next ingestion pass.',
        });
      }
    } catch {
      toast.error('Knowledge graph sync failed', {
        description: 'The correction was saved. It will be applied on the next ingestion pass.',
      });
    }

    // (f) Close panel — reached only after successful YAML write
    setIsSubmitting(false);
    close();
  }, [canonicalInput, confirmPhase, replaceAll, selectedText, editor, close]);

  if (!isOpen) return null;

  const dark = isDark();
  const borderColor = `var(--vscode-menu-border, ${dark ? '#454545' : '#d4d4d4'})`;
  const hoverBg = `var(--vscode-menu-selectionBackground, ${dark ? '#094771' : '#e8e8e8'})`;
  const mutedColor = dark ? '#888888' : '#999999';
  const inputBg = dark ? '#1e1e1e' : '#f5f5f5';
  const warningBg = dark ? '#4a3500' : '#fff8e1';
  const warningBorder = dark ? '#8a6800' : '#f0c000';

  const btnBase: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    border: `1px solid ${borderColor}`,
    background: 'transparent',
    color: `var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'})`,
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: `var(--vscode-button-background, ${dark ? '#0e639c' : '#007acc'})`,
    color: `var(--vscode-button-foreground, #ffffff)`,
    border: 'none',
    opacity: isSubmitting ? 0.6 : 1,
  };

  return (
    <div ref={panelRef} style={{ ...panelStyle(), left: position.x, top: position.y }}>
      {/* Header */}
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: mutedColor, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Correcting
        </span>
        <div style={{ fontWeight: 600, marginTop: '2px', wordBreak: 'break-word' }}>
          {selectedText}
        </div>
      </div>

      <hr style={{ margin: '8px 0', border: 'none', borderTop: `1px solid ${borderColor}` }} />

      {/* Suggestions */}
      {(allSuggestions.length > 0 || loadingEntities || loadingPassages) && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ color: mutedColor, fontSize: '11px', marginBottom: '4px' }}>
            Suggestions
          </div>

          {yamlSuggestions.length > 0 && (
            <div>
              {yamlSuggestions.map((name) => (
                <SuggestionItem
                  key={`yaml-${name}`}
                  name={name}
                  hoverBg={hoverBg}
                  onClick={() => setCanonicalInput(name)}
                />
              ))}
            </div>
          )}

          {loadingEntities ? (
            <div style={{ color: mutedColor, fontSize: '12px', padding: '4px 0' }}>
              Loading entity matches…
            </div>
          ) : entitySuggestions.length > 0 ? (
            <div>
              {entitySuggestions
                .filter((n) => !yamlSuggestions.some((y) => y.toLowerCase() === n.toLowerCase()))
                .map((name) => (
                  <SuggestionItem
                    key={`entity-${name}`}
                    name={name}
                    hoverBg={hoverBg}
                    onClick={() => setCanonicalInput(name)}
                  />
                ))}
            </div>
          ) : null}

          {loadingPassages ? (
            <div style={{ color: mutedColor, fontSize: '12px', padding: '4px 0' }}>
              Loading passage matches…
            </div>
          ) : passageSuggestions.length > 0 ? (
            <div>
              {passageSuggestions
                .filter(
                  (n) =>
                    !yamlSuggestions.some((y) => y.toLowerCase() === n.toLowerCase()) &&
                    !entitySuggestions.some((e) => e.toLowerCase() === n.toLowerCase())
                )
                .map((name) => (
                  <SuggestionItem
                    key={`passage-${name}`}
                    name={name}
                    hoverBg={hoverBg}
                    onClick={() => setCanonicalInput(name)}
                  />
                ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Canonical input */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '4px' }}>
          Canonical name
        </label>
        <input
          type="text"
          value={canonicalInput}
          onChange={(e) => setCanonicalInput(e.target.value)}
          placeholder="Enter correct name…"
          style={{
            width: '100%',
            padding: '5px 8px',
            borderRadius: '4px',
            border: `1px solid ${borderColor}`,
            background: inputBg,
            color: `var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'})`,
            fontSize: '13px',
            boxSizing: 'border-box',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleConfirm();
          }}
        />
      </div>

      {/* Replace all checkbox */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={replaceAll}
          onChange={(e) => setReplaceAll(e.target.checked)}
        />
        <span style={{ fontSize: '12px' }}>Replace all occurrences in this document</span>
      </label>

      {/* R13 canonical warning */}
      {confirmPhase === 'needs-canonical-warning' && (
        <div
          style={{
            marginBottom: '10px',
            padding: '8px',
            borderRadius: '4px',
            background: warningBg,
            border: `1px solid ${warningBorder}`,
            fontSize: '12px',
          }}
        >
          This term is already a canonical name for other aliases. Proceeding will re-canonicalize it.
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button style={btnBase} onClick={close}>
          Cancel
        </button>
        {confirmPhase === 'needs-canonical-warning' ? (
          <button
            style={btnPrimary}
            onClick={handleConfirm}
            disabled={isSubmitting || !canonicalInput.trim()}
          >
            Proceed anyway
          </button>
        ) : (
          <button
            style={btnPrimary}
            onClick={handleConfirm}
            disabled={isSubmitting || !canonicalInput.trim()}
          >
            {isSubmitting ? 'Saving…' : 'Confirm'}
          </button>
        )}
      </div>
    </div>
  );
}

function SuggestionItem({
  name,
  hoverBg,
  onClick,
}: {
  name: string;
  hoverBg: string;
  onClick: () => void;
}): JSX.Element {
  const dark = isDark();
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '4px 8px',
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        fontSize: '13px',
        borderRadius: '3px',
        color: `var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'})`,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {name}
    </button>
  );
}

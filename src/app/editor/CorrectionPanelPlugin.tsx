/**
 * CorrectionPanelPlugin — floating correction panel inside the Lexical editor.
 *
 * Opens when useCorrectionStore.isOpen is true. Loads suggestions from three
 * sources progressively: the host's corrections store (immediate), then entity
 * and passage suggestions from the host's knowledge services (async).
 *
 * On confirm, merges a same_as entry into the corrections document and asks the
 * host to apply it. All persistence and knowledge-graph access crosses the
 * package seam through `CorrectionHostServices` (see ADR-075); when the host
 * supplies no correction services the panel still opens, shows no suggestions,
 * and confirming performs only the in-document replacement.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isTextNode } from 'lexical';
import { useCorrectionStore } from '../../stores/correctionStore';
import { useEditorHost } from '../../host/context';
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
    background: `var(--liminis-editor-menu-background, var(--vscode-menu-background, ${dark ? '#252526' : '#ffffff'}))`,
    border: `1px solid var(--liminis-editor-menu-border, var(--vscode-menu-border, ${dark ? '#454545' : '#d4d4d4'}))`,
    boxShadow: dark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 16px rgba(0,0,0,0.15)',
    color: `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'}))`,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
  };
};

// --- Main component ---

export function CorrectionPanelPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { corrections, notifyError } = useEditorHost();
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
    if (!isOpen || !selectedText || !corrections) return;

    let cancelled = false;

    // Load YAML suggestions synchronously after file read
    const loadYaml = async () => {
      try {
        const raw = await corrections.readCorrections();
        if (cancelled) return;
        const entries = parseCorrectionsYaml(raw);
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
        const names = await corrections.suggestEntities(selectedText, 5);
        if (cancelled) return;
        setEntitySuggestions(names);
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
        const names = await corrections.suggestPassages(selectedText, 5, 0.3);
        if (cancelled) return;
        setPassageSuggestions(names);
      } catch {
        // Knowledge graph unavailable — silent
      } finally {
        if (!cancelled) setLoadingPassages(false);
      }
    };

    // Hosts back these services with an MCP stdio transport, which multiplexes
    // nothing: a second concurrent call to the same server is rejected rather
    // than queued. So serialize the two knowledge suggestion calls, while
    // keeping the corrections read concurrent (it is a different service).
    // The host relies on this ordering — do not parallelise.
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
  }, [isOpen, selectedText, corrections]);

  // Deduplicate suggestions across sources (case-insensitive), preserving order
  const allSuggestions = useMemo(() => {
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
  }, [yamlSuggestions, entitySuggestions, passageSuggestions]);

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
          // Escape selectedText for use in a regex, then add word boundaries so
          // "Tito" matches "Tito" and "Tito's" but not "Otito" or "titanium".
          const escaped = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp('\\b' + escaped + '\\b', 'g');
          const walk = (node: ReturnType<typeof $getRoot>): void => {
            if ($isTextNode(node)) {
              // Skip text inside code blocks — don't replace identifiers
              const parentType = node.getParent()?.getType() ?? '';
              if (parentType === 'code' || parentType === 'code-highlight') return;
              const content = node.getTextContent();
              const replaced = content.replace(regex, canonical);
              if (replaced !== content) node.setTextContent(replaced);
              return;
            }
            if ('getChildren' in node && typeof node.getChildren === 'function') {
              for (const child of (node as { getChildren: () => ReturnType<typeof $getRoot>[] }).getChildren()) {
                walk(child);
              }
            }
          };
          walk($getRoot());
        });
      }

      // (b) No host persistence available — the in-document replacement above is
      // all this package can do on its own.
      if (!corrections) {
        setIsSubmitting(false);
        close();
        return;
      }

      // (c) Re-read, merge, and write atomically — avoids overwriting corrections
      // added by other sources while the panel was open. The host owns mkdir and
      // atomic-write semantics.
      let latestEntries = yamlEntriesRef.current;
      try {
        const fresh = await corrections.readCorrections();
        latestEntries = parseCorrectionsYaml(fresh);
      } catch {
        // File missing or unreadable — start from empty (yamlEntriesRef is still the best fallback)
      }
      const updated = mergeCorrection(latestEntries, selectedText, canonical);
      const yaml = serializeCorrectionsYaml(updated);
      await corrections.writeCorrections(yaml);
      yamlEntriesRef.current = updated;
    } catch (err) {
      notifyError('Failed to save correction', err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
      return;
    }

    // (d) Apply corrections — isolated so a KG failure never blocks panel close
    try {
      const applied = await corrections.applyCorrections();
      if (!applied) {
        notifyError(
          'Knowledge graph sync failed',
          'The correction was saved. It will be applied on the next ingestion pass.'
        );
      }
    } catch {
      notifyError(
        'Knowledge graph sync failed',
        'The correction was saved. It will be applied on the next ingestion pass.'
      );
    }

    // (f) Close panel — reached only after successful YAML write
    setIsSubmitting(false);
    close();
  }, [canonicalInput, confirmPhase, replaceAll, selectedText, editor, close, corrections, notifyError]);

  if (!isOpen) return null;

  const dark = isDark();
  const borderColor = `var(--liminis-editor-menu-border, var(--vscode-menu-border, ${dark ? '#454545' : '#d4d4d4'}))`;
  const hoverBg = `var(--liminis-editor-menu-selectionBackground, var(--vscode-menu-selectionBackground, ${dark ? '#094771' : '#e8e8e8'}))`;
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
    color: `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'}))`,
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: `var(--liminis-editor-button-background, var(--vscode-button-background, ${dark ? '#0e639c' : '#007acc'}))`,
    color: `var(--liminis-editor-button-foreground, var(--vscode-button-foreground, #ffffff))`,
    border: 'none',
    opacity: isSubmitting ? 0.6 : 1,
  };

  return (
    <div
      ref={panelRef}
      style={{
        ...panelStyle(),
        left: Math.min(position.x, window.innerWidth - 380),
        top: Math.min(position.y, window.innerHeight - 450),
      }}
    >
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
            color: `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'}))`,
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
        color: `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${dark ? '#cccccc' : '#333333'}))`,
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

/**
 * FrontmatterPlugin - Shows frontmatter in a collapsible tray overlay
 * 
 * The actual FrontmatterNode is hidden via CSS but remains in the Lexical tree.
 * This plugin provides a UI to view/edit frontmatter in a sliding tray.
 * 
 * The toggle button is rendered externally (in the editor header).
 * This plugin communicates via Zustand store for state management.
 * 
 * For .mdc files (Cursor rules), a specialized form UI is shown with:
 * - alwaysApply dropdown (true/false)
 * - description text input
 * - globs array editor
 */

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getNodeByKey, $createTextNode, LexicalNode, $isElementNode } from 'lexical';
import { $isFrontmatterNode, FrontmatterNode } from './nodes';
import { useEditorStore } from '../../../renderer/stores/editorStore';

// Simple YAML frontmatter parser for MDC files
// Only handles the fields we need: description, alwaysApply, globs
interface MdcFrontmatter {
  description: string;
  alwaysApply: boolean | null; // null means not set
  globs: string[];
  // Preserve other lines we don't understand
  otherLines: string[];
}

function parseMdcFrontmatter(content: string): MdcFrontmatter {
  const lines = content.split('\n');
  const result: MdcFrontmatter = {
    description: '',
    alwaysApply: null,
    globs: [],
    otherLines: [],
  };

  let inGlobs = false;
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for description
    const descMatch = /^description:\s*(.*)$/.exec(line);
    if (descMatch) {
      result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
      inGlobs = false;
      continue;
    }

    // Check for alwaysApply
    const alwaysApplyMatch = /^alwaysApply:\s*(.*)$/.exec(line);
    if (alwaysApplyMatch) {
      const value = alwaysApplyMatch[1].trim().toLowerCase();
      result.alwaysApply = value === 'true';
      inGlobs = false;
      continue;
    }

    // Check for globs array start
    if (/^globs:\s*$/.exec(line)) {
      inGlobs = true;
      continue;
    }

    // Check for globs inline array: globs: ["*.ts", "*.tsx"]
    const inlineGlobsMatch = /^globs:\s*\[(.*)\]$/.exec(line);
    if (inlineGlobsMatch) {
      const items = inlineGlobsMatch[1].split(',').map(s => 
        s.trim().replace(/^["']|["']$/g, '')
      ).filter(s => s);
      result.globs = items;
      inGlobs = false;
      continue;
    }

    // If we're inside globs array, parse array items
    if (inGlobs && trimmed.startsWith('-')) {
      const item = trimmed.slice(1).trim().replace(/^["']|["']$/g, '');
      if (item) {
        result.globs.push(item);
      }
      continue;
    }

    // Any other non-empty line that's not a continuation of globs
    if (trimmed && !inGlobs) {
      inGlobs = false;
      result.otherLines.push(line);
    } else if (trimmed && inGlobs && !trimmed.startsWith('-')) {
      // Non-array item while in globs means globs section ended
      inGlobs = false;
      result.otherLines.push(line);
    }
  }

  return result;
}

function serializeMdcFrontmatter(fm: MdcFrontmatter): string {
  const lines: string[] = [];

  // Description first if set
  if (fm.description) {
    // Quote the description if it contains special characters
    const needsQuotes = /[:#[\]{}|>&*!?,]/.test(fm.description);
    lines.push(`description: ${needsQuotes ? `"${fm.description}"` : fm.description}`);
  }

  // alwaysApply if set
  if (fm.alwaysApply !== null) {
    lines.push(`alwaysApply: ${fm.alwaysApply}`);
  }

  // Globs array
  if (fm.globs.length > 0) {
    lines.push('globs:');
    for (const glob of fm.globs) {
      lines.push(`  - ${glob}`);
    }
  }

  // Preserve other lines
  for (const line of fm.otherLines) {
    lines.push(line);
  }

  return lines.join('\n');
}

// Find frontmatter node in the tree (should only be one, at the start)
function findFrontmatterNode(node: LexicalNode): FrontmatterNode | null {
  if ($isFrontmatterNode(node)) {
    return node;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      const found = findFrontmatterNode(child);
      if (found) return found;
    }
  }
  return null;
}

// Determine the effective rule type from the parsed frontmatter
type RuleType = 'always' | 'auto-attach' | 'intelligent' | 'manual';

function getRuleType(fm: MdcFrontmatter): RuleType {
  if (fm.alwaysApply === true) return 'always';
  if (fm.globs.length > 0) return 'auto-attach';
  if (fm.description) return 'intelligent';
  return 'manual';
}

const RULE_TYPE_INFO: Record<RuleType, { label: string; description: string; cursorLabel: string }> = {
  'always': {
    label: 'Always Apply',
    description: 'Included in every chat session automatically',
    cursorLabel: 'Always Apply'
  },
  'auto-attach': {
    label: 'Auto-Attach to Files',
    description: 'Applied when files matching glob patterns are in context',
    cursorLabel: 'Apply to Specific Files'
  },
  'intelligent': {
    label: 'Agent Decides',
    description: 'Agent decides relevance based on description',
    cursorLabel: 'Apply Intelligently'
  },
  'manual': {
    label: 'Manual Only',
    description: 'Only applied when @-mentioned (e.g., @rule-name)',
    cursorLabel: 'Apply Manually'
  }
};

// MDC-specific form for editing Cursor rule frontmatter
interface MdcFormProps {
  content: string;
  onContentChange: (content: string) => void;
}

function MdcFrontmatterForm({ content, onContentChange }: MdcFormProps) {
  const parsed = useMemo(() => parseMdcFrontmatter(content), [content]);
  const [newGlob, setNewGlob] = useState('');
  
  const currentRuleType = useMemo(() => getRuleType(parsed), [parsed]);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const updated = { ...parsed, description: e.target.value };
    onContentChange(serializeMdcFrontmatter(updated));
  }, [parsed, onContentChange]);

  const handleRuleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as RuleType;
    const updated = { ...parsed };
    
    switch (newType) {
      case 'always':
        updated.alwaysApply = true;
        // Keep existing globs and description, they're just ignored
        break;
      case 'auto-attach':
        updated.alwaysApply = null; // Remove alwaysApply
        // If no globs, add a placeholder to show intent
        if (updated.globs.length === 0) {
          updated.globs = ['**/*.md']; // Example pattern
        }
        break;
      case 'intelligent':
        updated.alwaysApply = false;
        updated.globs = []; // Clear globs
        // Ensure description exists
        if (!updated.description) {
          updated.description = 'Describe when this rule should apply...';
        }
        break;
      case 'manual':
        updated.alwaysApply = false;
        updated.globs = [];
        updated.description = ''; // Clear description
        break;
    }
    
    onContentChange(serializeMdcFrontmatter(updated));
  }, [parsed, onContentChange]);

  const handleRemoveGlob = useCallback((index: number) => {
    const newGlobs = parsed.globs.filter((_, i) => i !== index);
    const updated = { ...parsed, globs: newGlobs };
    onContentChange(serializeMdcFrontmatter(updated));
  }, [parsed, onContentChange]);

  const handleAddGlob = useCallback(() => {
    if (!newGlob.trim()) return;
    const updated = { ...parsed, globs: [...parsed.globs, newGlob.trim()] };
    onContentChange(serializeMdcFrontmatter(updated));
    setNewGlob('');
  }, [parsed, newGlob, onContentChange]);

  const handleGlobKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddGlob();
    }
  }, [handleAddGlob]);

  const info = RULE_TYPE_INFO[currentRuleType];

  return (
    <div className="mdc-form">
      {/* Rule Type selector - the primary control */}
      <div className="mdc-form-field">
        <label htmlFor="mdc-rule-type" className="mdc-form-label">
          Rule Type
          <span className="mdc-form-label-cursor">(Cursor: {info.cursorLabel})</span>
        </label>
        <select
          id="mdc-rule-type"
          className="mdc-form-select"
          value={currentRuleType}
          onChange={handleRuleTypeChange}
        >
          <option value="always">Always Apply — every chat session</option>
          <option value="auto-attach">Auto-Attach — when files match globs</option>
          <option value="intelligent">Agent Decides — based on description</option>
          <option value="manual">Manual Only — requires @mention</option>
        </select>
        <span className="mdc-form-hint mdc-form-hint-info">
          {info.description}
        </span>
      </div>

      {/* Description field - always shown, but more important for 'intelligent' type */}
      <div className="mdc-form-field">
        <label htmlFor="mdc-description" className="mdc-form-label">
          Description
          {currentRuleType === 'intelligent' && <span className="mdc-form-required">*</span>}
        </label>
        <input
          id="mdc-description"
          type="text"
          className="mdc-form-input"
          value={parsed.description}
          onChange={handleDescriptionChange}
          placeholder={currentRuleType === 'intelligent' 
            ? "Required: describe when this rule should apply..."
            : "Optional: describe what this rule does"}
        />
        {currentRuleType === 'intelligent' && (
          <span className="mdc-form-hint mdc-form-hint-warn">
            ⚠️ Agent uses this to decide relevance — be specific!
          </span>
        )}
      </div>

      {/* Globs array editor - only shown for auto-attach type */}
      {currentRuleType === 'auto-attach' && (
        <div className="mdc-form-field">
          <label className="mdc-form-label">
            File Patterns (globs)
            <span className="mdc-form-required">*</span>
          </label>
          <div className="mdc-globs-list">
            {parsed.globs.map((glob, index) => (
              <div key={index} className="mdc-glob-item">
                <code className="mdc-glob-pattern">{glob}</code>
                <button
                  type="button"
                  className="mdc-glob-remove"
                  onClick={() => handleRemoveGlob(index)}
                  title="Remove glob"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="mdc-glob-add">
            <input
              type="text"
              className="mdc-form-input"
              value={newGlob}
              onChange={(e) => setNewGlob(e.target.value)}
              onKeyDown={handleGlobKeyDown}
              placeholder="e.g., **/*.ts or src/components/**"
            />
            <button
              type="button"
              className="mdc-glob-add-btn"
              onClick={handleAddGlob}
              disabled={!newGlob.trim()}
            >
              Add
            </button>
          </div>
          <span className="mdc-form-hint">
            Rule auto-attaches when files matching these patterns are in context
          </span>
        </div>
      )}

      {/* Show raw YAML for other fields */}
      {parsed.otherLines.length > 0 && (
        <div className="mdc-form-field">
          <label className="mdc-form-label">Other Fields (raw YAML)</label>
          <pre className="mdc-other-yaml">{parsed.otherLines.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}

interface FrontmatterTrayProps {
  isOpen: boolean;
  content: string;
  onClose: () => void;
  onContentChange: (content: string) => void;
  isMdcFile?: boolean;
}

function FrontmatterTray({ isOpen, content, onClose, onContentChange, isMdcFile }: FrontmatterTrayProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
    }
  }, [content, isOpen, showRaw]);

  // Focus textarea when tray opens (only in raw mode)
  useEffect(() => {
    if (isOpen && textareaRef.current && (!isMdcFile || showRaw)) {
      textareaRef.current.focus();
    }
  }, [isOpen, isMdcFile, showRaw]);

  return (
    <div
      className={`frontmatter-tray ${isOpen ? 'frontmatter-tray-open' : ''}`}
    >
      <div className="frontmatter-tray-header">
        <span className="frontmatter-tray-title">
          {isMdcFile ? 'Cursor Rule Config' : 'Frontmatter'}
        </span>
        <div className="frontmatter-tray-actions">
          {isMdcFile && (
            <button
              className="frontmatter-tray-toggle-raw"
              onClick={() => setShowRaw(!showRaw)}
              title={showRaw ? 'Show form view' : 'Show raw YAML'}
            >
              {showRaw ? 'Form' : 'Raw'}
            </button>
          )}
          <button
            className="frontmatter-tray-close"
            onClick={onClose}
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <div className="frontmatter-tray-content">
        {isMdcFile && !showRaw ? (
          <MdcFrontmatterForm content={content} onContentChange={onContentChange} />
        ) : (
          <textarea
            ref={textareaRef}
            className="frontmatter-tray-textarea"
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="---&#10;title: Document Title&#10;---"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

interface FrontmatterPluginProps {
  filePath?: string;
}

export function FrontmatterPlugin({ filePath }: FrontmatterPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [frontmatterContent, setFrontmatterContent] = useState('');
  const [frontmatterNodeKey, setFrontmatterNodeKey] = useState<string | null>(null);
  
  // Use Zustand store for state management
  const setHasFrontmatter = useEditorStore((state) => state.setHasFrontmatter);
  const setFrontmatterOpen = useEditorStore((state) => state.setFrontmatterOpen);
  const isFrontmatterOpen = useEditorStore((state) => state.isFrontmatterOpen);

  // Detect if we're editing an MDC file (Cursor rules)
  const isMdcFile = useMemo(() => {
    return filePath?.endsWith('.mdc') ?? false;
  }, [filePath]);

  // Track frontmatter node and content
  useEffect(() => {
    const updateFrontmatter = () => {
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const frontmatterNode = findFrontmatterNode(root);
        
        if (frontmatterNode) {
          setHasFrontmatter(true);
          setFrontmatterContent(frontmatterNode.getTextContent());
          setFrontmatterNodeKey(frontmatterNode.getKey());
        } else {
          setHasFrontmatter(false);
          setFrontmatterContent('');
          setFrontmatterNodeKey(null);
        }
      });
    };

    // Initial check
    updateFrontmatter();

    // Listen for updates
    const unsubscribe = editor.registerUpdateListener(() => {
      updateFrontmatter();
    });

    return unsubscribe;
  }, [editor, setHasFrontmatter]);

  // Listen for toggle commands from the UI
  useEffect(() => {
    // Subscribe to store changes to detect toggle requests
    // The toggle function in the store handles the state change
    // We don't need to do anything here as the state is already managed
  }, []);

  // Update frontmatter content in the Lexical node
  const handleContentChange = useCallback((newContent: string) => {
    setFrontmatterContent(newContent);
    
    if (!frontmatterNodeKey) return;

    editor.update(() => {
      const node = $getNodeByKey(frontmatterNodeKey);
      if (node && $isFrontmatterNode(node)) {
        // Clear existing children and add new content
        node.clear();
        if (newContent) {
          node.append($createTextNode(newContent));
        }
      }
    });
  }, [editor, frontmatterNodeKey]);

  const handleClose = useCallback(() => {
    setFrontmatterOpen(false);
  }, [setFrontmatterOpen]);

  // Get hasFrontmatter from store
  const hasFrontmatter = useEditorStore((state) => state.hasFrontmatter);

  // Don't render anything if no frontmatter
  if (!hasFrontmatter) {
    return null;
  }

  return (
    <FrontmatterTray
      isOpen={isFrontmatterOpen}
      content={frontmatterContent}
      onClose={handleClose}
      onContentChange={handleContentChange}
      isMdcFile={isMdcFile}
    />
  );
}

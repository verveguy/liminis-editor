import { useCallback, useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  TextFormatType,
} from 'lexical';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { getSelectedNode } from './utils';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from './annotationCommands';

/** One toolbar-surfaced annotation kind's affordance, plain data only (FR-001/FR-009). */
export interface ToolbarAnnotationAffordance {
  kind: string;
  label: string;
  /**
   * Icon content to render as the button's visible children instead of the
   * plain-text `label`, fitting the 32×32 `.toolbar-button` box. Never
   * affects the button's accessible name — that always derives from `label`.
   */
  icon?: ReactNode;
}

interface ToolbarProps {
  annotationAffordances?: ToolbarAnnotationAffordance[];
}

// Consolidated toolbar state to batch updates
interface ToolbarState {
  isVisible: boolean;
  isBold: boolean;
  isItalic: boolean;
  isStrikethrough: boolean;
  isCode: boolean;
  isLink: boolean;
  position: { top: number; left: number };
  showLinkInput: boolean;
  linkUrl: string;
}

const initialToolbarState: ToolbarState = {
  isVisible: false,
  isBold: false,
  isItalic: false,
  isStrikethrough: false,
  isCode: false,
  isLink: false,
  position: { top: 0, left: 0 },
  showLinkInput: false,
  linkUrl: '',
};

export function Toolbar({ annotationAffordances = [] }: ToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>(initialToolbarState);
  const [editable, setEditable] = useState(editor.isEditable());
  const linkInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dismissedByClickRef = useRef(false);

  // Visibility + position, sourced from the native browser selection rather
  // than Lexical's. Lexical never reports a range selection on a
  // non-editable root, and doesn't reliably dispatch SELECTION_CHANGE_COMMAND
  // for a double-click word-selection even when editable — window.getSelection()
  // is accurate in both cases, matching AnnotationPlugin's own capture path.
  const updateVisibility = useCallback(() => {
    // Don't show toolbar if it was just dismissed by clicking outside
    if (dismissedByClickRef.current) {
      return;
    }

    // Don't hide the toolbar while focus is inside it. Opening the link
    // input moves focus (and therefore the native selection) away from the
    // editor root the instant it appears, which would otherwise look
    // identical to "selection left the editor" and close the input the user
    // just opened.
    if (toolbarRef.current && document.activeElement && toolbarRef.current.contains(document.activeElement)) {
      return;
    }

    const nativeSelection = window.getSelection();
    const rootElement = editor.getRootElement();

    // Both endpoints, not just one, must be inside the root — a selection
    // that only partially overlaps the editor (e.g. a drag starting in
    // surrounding page content and ending inside this editor) is deliberately
    // treated as "outside," not shown. AnnotationPlugin's capture wraps the
    // live native range directly in a Lexical mark; letting the toolbar
    // appear for a range that reaches outside the editor's own DOM would
    // make that affordance reachable for a selection capture was never
    // designed to wrap.
    if (
      !nativeSelection ||
      nativeSelection.rangeCount === 0 ||
      nativeSelection.isCollapsed ||
      !rootElement ||
      !nativeSelection.anchorNode ||
      !nativeSelection.focusNode ||
      !rootElement.contains(nativeSelection.anchorNode) ||
      !rootElement.contains(nativeSelection.focusNode)
    ) {
      setState(prev => prev.isVisible ? { ...prev, isVisible: false } : prev);
      return;
    }

    const range = nativeSelection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setState(prev => ({
      ...prev,
      isVisible: true,
      position: {
        top: rect.top - 45,
        left: rect.left + rect.width / 2,
      },
    }));
  }, [editor]);

  // Format-flag booleans (bold/italic/strikethrough/code/link) stay sourced
  // from Lexical's own selection, exactly as before — only computed while
  // editable, since the controls that display them don't render otherwise.
  // Must be called from inside an editor state read.
  //
  // Known limitation: this reads whatever Lexical's own $getSelection() last
  // reconciled, which Lexical updates from the native selection via its own
  // pointerdown-gated sync (see the native selectionchange listener below).
  // A genuine double-click always fires a real pointerdown first, so it
  // reconciles correctly; a selection change with no preceding pointerdown
  // on this root leaves these flags at their last-known value rather than
  // the newly-selected text's actual formatting (see the regression test
  // "format flags after a native-only selection with no preceding
  // pointerdown"). Deriving these flags any other way would mean
  // re-implementing bold/italic/link detection from raw DOM instead of
  // Lexical's model, which is out of scope per the spec's Assumptions.
  const updateFormatFlags = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
      return;
    }

    const node = getSelectedNode(selection);
    const parent = node.getParent();
    const isLink = $isLinkNode(parent) || $isLinkNode(node);

    setState(prev => ({
      ...prev,
      isBold: selection.hasFormat('bold'),
      isItalic: selection.hasFormat('italic'),
      isStrikethrough: selection.hasFormat('strikethrough'),
      isCode: selection.hasFormat('code'),
      isLink,
    }));
  }, []);

  // A selection can already be live when `editable` flips true (e.g. a
  // reviewer had bold text selected read-only, then the host makes the
  // document editable) — format flags must be recomputed on that transition,
  // not just left at their stale/default value until the next selection change.
  useEffect(() => {
    return editor.registerEditableListener((isEditable) => {
      setEditable(isEditable);
      if (isEditable) {
        editor.getEditorState().read(() => {
          updateFormatFlags();
        });
      }
    });
  }, [editor, updateFormatFlags]);

  useEffect(() => {
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateVisibility();
        if (editor.isEditable()) {
          editor.getEditorState().read(() => {
            updateFormatFlags();
          });
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    // Also listen for format changes to update button states
    const unregisterFormat = editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      () => {
        // Defer the update to run after the format is applied
        setTimeout(() => {
          if (editor.isEditable()) {
            editor.getEditorState().read(() => {
              updateFormatFlags();
            });
          }
        }, 0);
        return false;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      unregisterSelection();
      unregisterFormat();
    };
  }, [editor, updateVisibility, updateFormatFlags]);

  // Native selectionchange fires for every selection the browser makes,
  // including a non-editable root and a double-click word-selection — neither
  // of which reliably drives SELECTION_CHANGE_COMMAND (FR-001/FR-002).
  //
  // For a normal drag-selection while editable, this listener and the
  // SELECTION_CHANGE_COMMAND handler above both fire for the same underlying
  // browser event (Lexical's own command is itself dispatched from its
  // internal selectionchange handling), so a single real selection change
  // runs updateVisibility/updateFormatFlags twice. This is intentional, not
  // an oversight: both computations are idempotent (same selection in ⇒ same
  // state out), the extra pass is cheap, and de-duplicating the two triggers
  // would mean re-introducing a way to tell "did SELECTION_CHANGE_COMMAND
  // already run for this event" — more state to get wrong than the
  // duplicate, harmless recompute it would save.
  useEffect(() => {
    const handleNativeSelectionChange = () => {
      updateVisibility();
      if (editor.isEditable()) {
        editor.getEditorState().read(() => {
          updateFormatFlags();
        });
      }
    };

    document.addEventListener('selectionchange', handleNativeSelectionChange);
    return () => document.removeEventListener('selectionchange', handleNativeSelectionChange);
  }, [editor, updateVisibility, updateFormatFlags]);

  // Dismiss toolbar immediately on mousedown outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // If toolbar is not visible, nothing to do
      if (!state.isVisible) return;

      // If click is inside the toolbar, don't dismiss
      if (toolbarRef.current?.contains(e.target as Node)) {
        return;
      }

      // Set flag to prevent selection change from re-showing toolbar
      dismissedByClickRef.current = true;

      // Dismiss immediately
      setState(prev => ({ ...prev, isVisible: false, showLinkInput: false }));

      // Reset flag after selection events have settled
      setTimeout(() => {
        dismissedByClickRef.current = false;
      }, 100);
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [state.isVisible]);

  const formatText = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor]
  );

  const openLinkInput = useCallback(() => {
    if (state.isLink) {
      // Remove link
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    } else {
      // Show link input
      setState(prev => ({ ...prev, showLinkInput: true, linkUrl: '' }));
      // Focus the input after it renders
      setTimeout(() => linkInputRef.current?.focus(), 0);
    }
  }, [editor, state.isLink]);

  const submitLink = useCallback(() => {
    if (state.linkUrl) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, state.linkUrl);
    }
    setState(prev => ({ ...prev, showLinkInput: false, linkUrl: '' }));
  }, [editor, state.linkUrl]);

  const cancelLink = useCallback(() => {
    setState(prev => ({ ...prev, showLinkInput: false, linkUrl: '' }));
  }, []);

  const createAnnotation = useCallback(
    (kind: string) => {
      editor.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, { kind });
    },
    [editor]
  );

  // Formatting controls are inert on a read-only root, so they never render
  // there (FR-004); with nothing else to offer, the whole toolbar stays
  // hidden too (FR-006) rather than rendering an empty bar.
  if (!state.isVisible || (!editable && annotationAffordances.length === 0)) return null;

  return (
    <div
      ref={toolbarRef}
      className="toolbar"
      style={{
        position: 'fixed',
        top: state.position.top,
        left: state.position.left,
        transform: 'translateX(-50%)',
      }}
    >
      {editable && (
        <>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              formatText('bold');
            }}
            className={`toolbar-button ${state.isBold ? 'active' : ''}`}
            aria-label="Bold"
            title="Bold (Cmd+B)"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              formatText('italic');
            }}
            className={`toolbar-button ${state.isItalic ? 'active' : ''}`}
            aria-label="Italic"
            title="Italic (Cmd+I)"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              formatText('strikethrough');
            }}
            className={`toolbar-button ${state.isStrikethrough ? 'active' : ''}`}
            aria-label="Strikethrough"
            title="Strikethrough"
          >
            <s>S</s>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              formatText('code');
            }}
            className={`toolbar-button ${state.isCode ? 'active' : ''}`}
            aria-label="Code"
            title="Inline Code (Cmd+E)"
          >
            {'</>'}
          </button>
          <div className="toolbar-divider" />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              openLinkInput();
            }}
            className={`toolbar-button ${state.isLink ? 'active' : ''}`}
            aria-label="Link"
            title="Link (Cmd+K)"
          >
            🔗
          </button>
          {state.showLinkInput && (
            <div className="toolbar-link-input">
              <input
                ref={linkInputRef}
                type="text"
                placeholder="Enter URL..."
                value={state.linkUrl}
                onChange={(e) => setState(prev => ({ ...prev, linkUrl: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitLink();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelLink();
                  }
                }}
                onBlur={cancelLink}
              />
            </div>
          )}
        </>
      )}
      {annotationAffordances.length > 0 && (
        <>
          {editable && <div className="toolbar-divider" />}
          {annotationAffordances.map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                createAnnotation(kind);
              }}
              className="toolbar-button"
              aria-label={label}
              title={label}
            >
              {icon ?? label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * C4Component - React component for rendering and editing C4 architecture diagrams
 *
 * Uses the canonical React C4Renderer for diagram display.
 * Provides editing UI (textarea overlay, click-to-edit) for the Lexical editor.
 * Supports manual layout mode for drag-and-drop positioning of elements.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  NodeKey,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { Move, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseC4, validateC4, layoutC4Diagram } from '@liminis/diagrams/core';
import { C4Renderer, C4ErrorDisplay, C4InteractiveRenderer } from '@liminis/diagrams/react';
import { $isC4Node } from './C4Node';
import { DiagramContextMenu, useDiagramContextMenu } from './DiagramContextMenu';
import type { ManualLayout } from '@liminis/diagrams/core';

// =============================================================================
// C4 DIAGRAM DISPLAY
// =============================================================================

interface C4DiagramDisplayProps {
  code: string;
  nodeKey: NodeKey;
  onDoubleClick: () => void;
  isEditable: boolean;
}

function C4DiagramDisplay({
  code,
  nodeKey,
  onDoubleClick,
  isEditable,
}: C4DiagramDisplayProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const contextMenu = useDiagramContextMenu();
  const previousCodeRef = useRef(code);

  // Read manual layout from the node
  const [manualLayout, setManualLayout] = useState<ManualLayout | undefined>(() => {
    return editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isC4Node(node)) {
        return node.getManualLayout();
      }
      return undefined;
    });
  });

  // Sync manual layout from node when it changes externally (e.g., undo/redo)
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isC4Node(node)) {
          const nodeLayout = node.getManualLayout();
          setManualLayout(nodeLayout);
        }
      });
    });
  }, [editor, nodeKey]);

  // Detect theme using MutationObserver
  useEffect(() => {
    const detectTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // Parse, validate, and layout the diagram
  const parseResult = useMemo(() => {
    const pr = parseC4(code);
    if (pr.diagram) {
      const validationErrors = validateC4(pr.diagram);
      pr.errors.push(...validationErrors);
    }
    return pr;
  }, [code]);

  const layout = useMemo(() => {
    if (!parseResult.diagram || parseResult.errors.length > 0) return null;
    const positions = manualLayout?.positions;
    return layoutC4Diagram(parseResult.diagram, undefined, positions);
  }, [parseResult, manualLayout]);

  // TASK 7: Clear manual layout when DSL code changes (elements added/removed)
  useEffect(() => {
    if (manualLayout && code !== previousCodeRef.current && parseResult.diagram) {
      const newElementIds = new Set(parseResult.diagram.elements.map(e => e.id));
      const oldElementIds = new Set(
        Object.keys(manualLayout.positions).filter(id => !id.startsWith('__'))
      );

      // Check if elements were added or removed
      const hasChanges =
        newElementIds.size !== oldElementIds.size ||
        [...newElementIds].some(id => !oldElementIds.has(id)) ||
        [...oldElementIds].some(id => !newElementIds.has(id));

      if (hasChanges) {
        // Clear manual layout
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isC4Node(node)) {
            node.setManualLayout(undefined);
          }
        });
        setIsEditingLayout(false);
      }
    }
    previousCodeRef.current = code;
  }, [code, manualLayout, parseResult.diagram, editor, nodeKey]);

  // TASK 6: Handle position changes with Lexical undo integration
  // The update listener above will sync manualLayout state from the node,
  // so we only need to write to the Lexical node here.
  const handlePositionChange = useCallback((newPositions: Record<string, { x: number; y: number }>) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isC4Node(node)) {
        node.setManualLayout({ positions: newPositions });
      }
    });
  }, [editor, nodeKey]);

  // Handle reset to auto layout
  const handleResetLayout = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isC4Node(node)) {
        node.setManualLayout(undefined);
      }
    });
    setManualLayout(undefined);
    setIsEditingLayout(false);
  }, [editor, nodeKey]);

  // Exit edit mode when clicking outside or pressing Escape
  useEffect(() => {
    if (!isEditingLayout) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsEditingLayout(false);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (e.target instanceof Node && !container.contains(e.target)) {
        setIsEditingLayout(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isEditingLayout]);

  if (!layout || !parseResult.diagram) {
    return <C4ErrorDisplay errors={parseResult.errors} isDarkMode={isDarkMode} />;
  }

  const manualPositions = manualLayout?.positions ?? {};

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      onDoubleClick={isEditingLayout ? undefined : onDoubleClick}
      onContextMenu={(e) => contextMenu.show(e, containerRef)}
      onKeyDown={(e) => {
        if (!isEditingLayout && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDoubleClick();
        }
      }}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
      className="c4-renderer c4-diagram-container"
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '1rem',
        cursor: isEditingLayout ? 'default' : 'pointer',
        minHeight: '100px',
        overflowX: 'auto',
        position: 'relative',
      }}
    >
      {/* TASK 5: Layout mode toolbar */}
      {isEditable && (showToolbar || isEditingLayout) && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            gap: '4px',
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingLayout(!isEditingLayout);
            }}
            title={isEditingLayout ? 'Exit layout mode' : 'Edit layout'}
            aria-label={isEditingLayout ? 'Exit layout mode' : 'Edit layout'}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: isEditingLayout
                ? 'var(--liminis-editor-primary-100)'
                : 'var(--liminis-editor-muted-100)',
              color: isEditingLayout
                ? 'var(--liminis-editor-primary)'
                : 'var(--liminis-editor-muted-foreground)',
            }}
          >
            <Move size={16} />
          </button>
          {manualLayout && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleResetLayout();
              }}
              title="Reset to auto layout"
              aria-label="Reset to auto layout"
              style={{
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--liminis-editor-muted-100)',
                color: 'var(--liminis-editor-muted-foreground)',
              }}
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      )}

      {/* Render diagram - use interactive renderer in edit mode */}
      {isEditingLayout && parseResult.diagram ? (
        <C4InteractiveRenderer
          diagram={parseResult.diagram}
          isDarkMode={isDarkMode}
          isEditMode={isEditingLayout}
          manualPositions={manualPositions}
          onPositionChange={handlePositionChange}
        />
      ) : (
        <C4Renderer layout={layout} isDarkMode={isDarkMode} />
      )}

      <DiagramContextMenu
        {...contextMenu.props}
        onEditText={isEditable ? onDoubleClick : undefined}
        onEditLayout={isEditable ? () => setIsEditingLayout(prev => !prev) : undefined}
        onResetLayout={isEditable ? handleResetLayout : undefined}
        isEditingLayout={isEditingLayout}
        hasManualLayout={!!manualLayout}
      />
    </div>
  );
}

// =============================================================================
// C4 EDITOR
// =============================================================================

function C4Editor({
  code,
  setCode,
  onClose,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="c4-editor-container">
      <div className="c4-editor-header">
        <span className="c4-editor-label">```c4</span>
        <button
          className="c4-editor-close"
          onClick={onClose}
          title="Close editor (Esc)"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="c4-editor-textarea"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter C4 diagram code..."
        spellCheck={false}
      />
      <div className="c4-editor-footer">
        <span className="c4-editor-label">```</span>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN C4 COMPONENT
// =============================================================================

interface C4ComponentProps {
  code: string;
  nodeKey: NodeKey;
}

export default function C4Component({
  code,
  nodeKey,
}: C4ComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const [codeValue, setCodeValue] = useState(code);
  const [showEditor, setShowEditor] = useState<boolean>(false);

  // Listen for editable changes
  useEffect(() => {
    return editor.registerEditableListener((editable) => {
      setIsEditable(editable);
    });
  }, [editor]);

  const onHide = useCallback(() => {
    setShowEditor(false);
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isC4Node(node)) {
        node.setCode(codeValue);
      }
    });
  }, [editor, codeValue, nodeKey]);

  useEffect(() => {
    if (!showEditor && codeValue !== code) {
      setCodeValue(code);
    }
  }, [showEditor, code, codeValue]);

  useEffect(() => {
    if (!isEditable) {
      return;
    }
    if (showEditor) {
      return mergeRegister(
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            // Don't close on selection change while editing
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (showEditor) {
              onHide();
              return true;
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      );
    } else {
      return editor.registerUpdateListener(({ editorState }) => {
        const isSelected = editorState.read(() => {
          const selection = $getSelection();
          return (
            $isNodeSelection(selection) &&
            selection.has(nodeKey) &&
            selection.getNodes().length === 1
          );
        });
        if (isSelected) {
          setShowEditor(true);
        }
      });
    }
  }, [editor, nodeKey, onHide, showEditor, isEditable]);

  if (showEditor && isEditable) {
    return (
      <C4Editor
        code={codeValue}
        setCode={setCodeValue}
        onClose={onHide}
      />
    );
  }

  return (
    <C4DiagramDisplay
      code={codeValue}
      nodeKey={nodeKey}
      isEditable={isEditable}
      onDoubleClick={() => {
        if (isEditable) {
          setShowEditor(true);
        }
      }}
    />
  );
}

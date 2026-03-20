/**
 * C4Component - React component for rendering and editing C4 architecture diagrams
 *
 * Uses the canonical React C4Renderer for diagram display.
 * Provides editing UI (textarea overlay, click-to-edit) for the Lexical editor.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseC4, validateC4 } from '../c4/parser';
import { layoutC4Diagram } from '../c4/layout';
import { C4Renderer, C4ErrorDisplay } from '../c4/renderer';
import { $isC4Node } from './C4Node';

// =============================================================================
// C4 DIAGRAM DISPLAY
// =============================================================================

function C4DiagramDisplay({
  code,
  onDoubleClick,
}: {
  code: string;
  onDoubleClick: () => void;
}): JSX.Element {
  const [isDarkMode, setIsDarkMode] = useState(false);

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
    return layoutC4Diagram(parseResult.diagram);
  }, [parseResult]);

  if (!layout) {
    return <C4ErrorDisplay errors={parseResult.errors} isDarkMode={isDarkMode} />;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDoubleClick();
        }
      }}
      className="c4-renderer"
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '1rem',
        cursor: 'pointer',
        minHeight: '100px',
      }}
    >
      <C4Renderer layout={layout} isDarkMode={isDarkMode} />
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
      onDoubleClick={() => {
        if (isEditable) {
          setShowEditor(true);
        }
      }}
    />
  );
}

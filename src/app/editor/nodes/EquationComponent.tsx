/**
 * EquationComponent - React component for rendering and editing LaTeX equations
 * Ported from Lexical playground with modifications for SlashMD
 * 
 * TODO: Block math equations should be centered but centering doesn't work properly.
 * The issue is likely related to Shadow DOM style inheritance - the :host(.block)
 * selector and text-align: center are set but not taking effect. May need to
 * investigate the container element structure or use a different centering approach.
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
import { useCallback, useEffect, useRef, useState, ChangeEvent, forwardRef, RefObject } from 'react';
import { createBrowserAdaptorDocument } from '../../../mathjax-config';
import { $isEquationNode } from './EquationNode';

// Initialize MathJax once for the renderer process
const { adaptor: mathjaxAdaptor, document: mathjaxDocument } = createBrowserAdaptorDocument(document);

// MathJax SVG Renderer component — replaces KaTeX with MathJax for higher quality rendering
function MathJaxRenderer({
  equation,
  inline,
  onDoubleClick,
}: {
  equation: string;
  inline: boolean;
  onDoubleClick: () => void;
}): JSX.Element {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    try {
      // Normalize escaped backslashes from markdown sources
      const renderEquation = equation.replace(/\\\\([a-zA-Z])/g, '\\$1');

      // Clear previous render
      container.innerHTML = '';

      // Render with MathJax
      const node = mathjaxDocument.convert(renderEquation, { display: !inline });

      // MathJax returns an element — append it directly
      if (node instanceof Node) {
        container.appendChild(node);
      } else {
        // Fallback: use innerHTML from adaptor
        container.innerHTML = mathjaxAdaptor.innerHTML(node);
      }
    } catch {
      container.textContent = equation;
    }
  }, [equation, inline]);

  return (
    <span
      role="button"
      tabIndex={-1}
      onDoubleClick={onDoubleClick}
      ref={containerRef}
      className={`equation-renderer ${inline ? 'inline' : 'block'}`}
      style={{ display: inline ? 'inline' : 'block', textAlign: inline ? 'inherit' : 'center' }}
    />
  );
}

// Equation Editor component
interface EquationEditorProps {
  equation: string;
  inline: boolean;
  setEquation: (equation: string) => void;
}

const EquationEditor = forwardRef<HTMLInputElement | HTMLTextAreaElement, EquationEditorProps>(
  function EquationEditor({ equation, setEquation, inline }, forwardedRef) {
    const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEquation(event.target.value);
    };

    if (inline) {
      return (
        <span className="equation-editor-background">
          <span className="equation-dollar-sign">$</span>
          <input
            className="equation-inline-editor"
            value={equation}
            onChange={onChange}
            autoFocus={true}
            ref={forwardedRef as RefObject<HTMLInputElement>}
          />
          <span className="equation-dollar-sign">$</span>
        </span>
      );
    }

    return (
      <div className="equation-editor-background">
        <span className="equation-dollar-sign">{'$$'}</span>
        <textarea
          className="equation-block-editor"
          value={equation}
          onChange={onChange}
          autoFocus={true}
          ref={forwardedRef as RefObject<HTMLTextAreaElement>}
        />
        <span className="equation-dollar-sign">{'$$'}</span>
      </div>
    );
  }
);

// Main EquationComponent
interface EquationComponentProps {
  equation: string;
  inline: boolean;
  nodeKey: NodeKey;
}

export default function EquationComponent({
  equation,
  inline,
  nodeKey,
}: EquationComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const [equationValue, setEquationValue] = useState(equation);
  const [showEquationEditor, setShowEquationEditor] = useState<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // Listen for editable changes
  useEffect(() => {
    return editor.registerEditableListener((editable) => {
      setIsEditable(editable);
    });
  }, [editor]);

  const onHide = useCallback(
    (restoreSelection?: boolean) => {
      setShowEquationEditor(false);
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isEquationNode(node)) {
          node.setEquation(equationValue);
          if (restoreSelection) {
            node.selectNext(0, 0);
          }
        }
      });
    },
    [editor, equationValue, nodeKey],
  );

  useEffect(() => {
    if (!showEquationEditor && equationValue !== equation) {
      setEquationValue(equation);
    }
  }, [showEquationEditor, equation, equationValue]);

  useEffect(() => {
    if (!isEditable) {
      return;
    }
    if (showEquationEditor) {
      return mergeRegister(
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            const activeElement = document.activeElement;
            const inputElem = inputRef.current;
            if (inputElem !== activeElement) {
              onHide();
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            const activeElement = document.activeElement;
            const inputElem = inputRef.current;
            if (inputElem === activeElement) {
              onHide(true);
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
          setShowEquationEditor(true);
        }
      });
    }
  }, [editor, nodeKey, onHide, showEquationEditor, isEditable]);

  if (showEquationEditor && isEditable) {
    return (
      <EquationEditor
        equation={equationValue}
        setEquation={setEquationValue}
        inline={inline}
        ref={inputRef}
      />
    );
  }

  return (
    <MathJaxRenderer
      equation={equationValue}
      inline={inline}
      onDoubleClick={() => {
        if (isEditable) {
          setShowEquationEditor(true);
        }
      }}
    />
  );
}

/**
 * Lexical plugin that shows a context menu when right-clicking a text selection.
 * Provides a "Chat about this..." action that passes the selected text and click
 * position to the host via callback, and a "Correction…" action that opens the
 * inline correction panel.
 *
 * Follows the TableActionsPlugin pattern for attaching to the editor root element,
 * and the DiagramContextMenu pattern for the overlay menu UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from './annotationCommands';
import { $getSelection, $isRangeSelection } from 'lexical';
import { useCorrectionStore } from '../../stores/correctionStore';

export interface SelectionContextMenuEvent {
  position: { x: number; y: number };
  selectedText: string;
}

interface SelectionContextMenuPluginProps {
  onSelectionContextMenu?: (event: SelectionContextMenuEvent) => void;
  /** True when the host configured a `correction` annotation kind (ADR-076). */
  correctionKindEnabled?: boolean;
}

// --- Menu overlay component ---

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  borderRadius: '6px',
  padding: '4px 0',
  minWidth: '180px',
};

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  background: 'transparent',
  border: 'none',
  fontSize: '13px',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

interface SelectionContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  onChatAboutThis: (() => void) | null;
  /**
   * Routes the "Correction…" entry through the shared annotation create
   * command when the host has configured a `correction` kind. Null when it
   * hasn't, in which case the entry behaves exactly as it always has.
   */
  onCaptureCorrectionAnchor: (() => void) | null;
  onClose: () => void;
}

function SelectionContextMenu({
  visible,
  x,
  y,
  selectedText,
  onChatAboutThis,
  onCaptureCorrectionAnchor,
  onClose,
}: SelectionContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const bgColor = `var(--vscode-menu-background, ${isDark ? '#252526' : '#ffffff'})`;
  const borderColor = `var(--vscode-menu-border, ${isDark ? '#454545' : '#d4d4d4'})`;
  const textColor = `var(--vscode-menu-foreground, ${isDark ? '#cccccc' : '#333333'})`;
  const hoverBg = `var(--vscode-menu-selectionBackground, ${isDark ? '#094771' : '#e8e8e8'})`;

  useEffect(() => {
    if (!visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const handleHover = (e: React.MouseEvent, entering: boolean) => {
    (e.currentTarget as HTMLElement).style.background = entering ? hoverBg : 'transparent';
  };

  const handleCorrection = () => {
    // Corrections are a kind of the unified annotation mechanism (ADR-076):
    // authoring one captures an anchor through the same primitive comments
    // use. The `correction` kind discards its transient mark, so nothing
    // paints and the visible behaviour below is unchanged.
    onCaptureCorrectionAnchor?.();
    useCorrectionStore.getState().open({ x, y }, selectedText);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{
        ...menuStyle,
        left: x,
        top: y,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.3)' : '0 4px 12px rgba(0,0,0,0.12)',
      }}
    >
      {onChatAboutThis && (
        <button
          onClick={() => { onChatAboutThis(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          Chat about this…
        </button>
      )}
      {onChatAboutThis && (
        <hr style={{ margin: '4px 0', border: 'none', borderTop: `1px solid ${borderColor}` }} />
      )}
      <button
        onClick={handleCorrection}
        style={{ ...itemStyle, color: textColor }}
        onMouseEnter={(e) => handleHover(e, true)}
        onMouseLeave={(e) => handleHover(e, false)}
      >
        Correction…
      </button>
    </div>
  );
}

// --- Plugin ---

export function SelectionContextMenuPlugin({
  onSelectionContextMenu,
  correctionKindEnabled = false,
}: SelectionContextMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    x: number;
    y: number;
    selectedText: string;
  }>({ visible: false, x: 0, y: 0, selectedText: '' });

  const close = useCallback(() => {
    setMenuState((prev) => ({ ...prev, visible: false }));
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

        const selectedText = selection.getTextContent();
        if (!selectedText.trim()) return;

        e.preventDefault();

        setMenuState({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          selectedText,
        });
      });
    };

    const editorElement = editor.getRootElement();
    if (editorElement) {
      editorElement.addEventListener('contextmenu', handleContextMenu);
      return () => editorElement.removeEventListener('contextmenu', handleContextMenu);
    }
  }, [editor]);

  // Dispatching the command rather than calling the capture primitive
  // directly is deliberate: `annotationCommands` declares the command and
  // nothing else, so this statically-imported plugin can enter the annotation
  // mechanism without pulling any annotation machinery into the default
  // (annotations-disabled) import graph. The listener lives in the lazily
  // loaded surface, and is simply absent when annotations are off.
  const captureCorrectionAnchor = useCallback(() => {
    editor.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, { kind: 'correction' });
  }, [editor]);

  const handleChatAboutThis = useCallback(() => {
    if (onSelectionContextMenu && menuState.selectedText) {
      onSelectionContextMenu({
        position: { x: menuState.x, y: menuState.y },
        selectedText: menuState.selectedText,
      });
    }
  }, [onSelectionContextMenu, menuState]);

  return (
    <SelectionContextMenu
      visible={menuState.visible}
      x={menuState.x}
      y={menuState.y}
      selectedText={menuState.selectedText}
      onChatAboutThis={onSelectionContextMenu ? handleChatAboutThis : null}
      onCaptureCorrectionAnchor={correctionKindEnabled ? captureCorrectionAnchor : null}
      onClose={close}
    />
  );
}

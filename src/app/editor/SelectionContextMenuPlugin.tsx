/**
 * Lexical plugin that shows a context menu when right-clicking a text selection.
 * Provides a "Chat about this..." action that passes the selected text and click
 * position to the host via callback, plus one entry per configured
 * `contextMenu`-surfaced annotation kind (ADR-077) — `correction` additionally
 * opens the legacy inline correction panel.
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

/** One context-menu-surfaced annotation kind's affordance, plain data only (FR-004/FR-010). */
export interface ContextMenuAnnotationAffordance {
  kind: string;
  label: string;
}

interface SelectionContextMenuPluginProps {
  onSelectionContextMenu?: (event: SelectionContextMenuEvent) => void;
  /** One entry per configured kind whose `createAffordance.surface` is `contextMenu` (ADR-077). */
  annotationAffordances?: ContextMenuAnnotationAffordance[];
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
  /** One entry per configured kind whose `createAffordance.surface` is `contextMenu`. */
  annotationAffordances: ContextMenuAnnotationAffordance[];
  /** Dispatches `OPEN_ANNOTATION_COMPOSER_COMMAND` for the given kind. */
  onCreateAnnotation: (kind: string) => void;
  onClose: () => void;
}

function SelectionContextMenu({
  visible,
  x,
  y,
  selectedText,
  onChatAboutThis,
  annotationAffordances,
  onCreateAnnotation,
  onClose,
}: SelectionContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const bgColor = `var(--liminis-editor-menu-background, var(--vscode-menu-background, ${isDark ? '#252526' : '#ffffff'}))`;
  const borderColor = `var(--liminis-editor-menu-border, var(--vscode-menu-border, ${isDark ? '#454545' : '#d4d4d4'}))`;
  const textColor = `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${isDark ? '#cccccc' : '#333333'}))`;
  const hoverBg = `var(--liminis-editor-menu-selectionBackground, var(--vscode-menu-selectionBackground, ${isDark ? '#094771' : '#e8e8e8'}))`;

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

  const handleAnnotationClick = (kind: string) => {
    // Every kind on this surface enters the same shared capture path
    // (ADR-077). `correction` additionally opens the legacy, name-gated
    // correction panel (Out-of-Scope: this generalizes only the dispatch, not
    // the panel). The `correction` kind discards its transient mark, so
    // nothing paints and the panel's visible behaviour is unchanged. A host
    // that supplies no `onCreateAnnotation` (as liminis-app does not) has no
    // handler registered for the command, so dispatch is simply a no-op there.
    //
    // CAUTION for future hosts: if a host ever configures a kind literally
    // named `correction` *and* supplies `onCreateAnnotation`, both fire off
    // this one click — the host's generic create flow and this hardcoded
    // legacy panel, with no coordination between them. See the caveat on
    // `AnnotationKindConfig` in `annotations/types.ts`.
    onCreateAnnotation(kind);
    if (kind === 'correction') {
      useCorrectionStore.getState().open({ x, y }, selectedText);
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      // Keep the document selection alive across a menu click. This overlay is
      // a fixed-position sibling of the contenteditable, so pressing a button
      // in it moves focus out of the editor on `mousedown` and collapses
      // `window.getSelection()` — before any `onClick` handler runs. The
      // annotation create path reads that native selection
      // (`AnnotationPlugin`) and bails silently on a collapsed one, so a
      // contextMenu-surfaced kind would capture no anchor while the correction
      // panel still opened as if nothing had gone wrong (review finding,
      // @handarbeit-pruefer). Preventing the default mousedown action stops
      // the focus shift without affecting the subsequent click.
      //
      // Liminis doesn't feel this today only because it supplies no
      // `onCreateAnnotation`, leaving the command unlistened — i.e. it would
      // have bitten the first host to wire the callback up.
      onMouseDown={(e) => e.preventDefault()}
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
      {onChatAboutThis && annotationAffordances.length > 0 && (
        <hr style={{ margin: '4px 0', border: 'none', borderTop: `1px solid ${borderColor}` }} />
      )}
      {annotationAffordances.map(({ kind, label }) => (
        <button
          key={kind}
          onClick={() => handleAnnotationClick(kind)}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// --- Plugin ---

export function SelectionContextMenuPlugin({
  onSelectionContextMenu,
  annotationAffordances = [],
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
  const dispatchCreateAnnotation = useCallback(
    (kind: string) => {
      editor.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, { kind });
    },
    [editor]
  );

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
      annotationAffordances={annotationAffordances}
      onCreateAnnotation={dispatchCreateAnnotation}
      onClose={close}
    />
  );
}

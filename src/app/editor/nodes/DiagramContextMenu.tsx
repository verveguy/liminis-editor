/* eslint-disable react-refresh/only-export-components */
/**
 * Shared context menu overlay for diagram nodes (C4, Mermaid).
 * Provides "Copy image to clipboard" and optional diagram-specific actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyDiagramToClipboard } from './diagram-context-menu';

export interface DiagramContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLElement | null> | null;
}

export interface DiagramContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onCopyImage: () => void;
  onClose: () => void;
  /** Optional: enter DSL text editor (double-click equivalent) */
  onEditText?: () => void;
  /** Optional: toggle drag layout mode */
  onEditLayout?: () => void;
  /** Optional: reset to auto layout */
  onResetLayout?: () => void;
  /** Whether drag layout mode is currently active */
  isEditingLayout?: boolean;
  /** Whether manual layout exists (show reset option) */
  hasManualLayout?: boolean;
}

/**
 * Hook to manage diagram context menu state.
 */
export function useDiagramContextMenu() {
  const [state, setState] = useState<DiagramContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    containerRef: null,
  });

  const show = useCallback((e: React.MouseEvent, containerRef: React.RefObject<HTMLElement | null>) => {
    e.preventDefault();
    e.stopPropagation();
    setState({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      containerRef,
    });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (state.containerRef?.current) {
      await copyDiagramToClipboard(state.containerRef.current);
    }
    close();
  }, [state.containerRef, close]);

  return {
    show,
    props: {
      visible: state.visible,
      x: state.x,
      y: state.y,
      onCopyImage: handleCopyImage,
      onClose: close,
    },
  };
}

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

const separatorStyle: React.CSSProperties = {
  height: '1px',
  margin: '4px 8px',
};

/**
 * Context menu overlay component. Uses CSS variables for theming
 * with light/dark hex fallbacks for environments without VS Code vars.
 */
export function DiagramContextMenu({
  visible,
  x,
  y,
  onCopyImage,
  onClose,
  onEditText,
  onEditLayout,
  onResetLayout,
  isEditingLayout,
  hasManualLayout,
}: DiagramContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const bgColor = `var(--liminis-editor-menu-background, var(--vscode-menu-background, ${isDark ? '#252526' : '#ffffff'}))`;
  const borderColor = `var(--liminis-editor-menu-border, var(--vscode-menu-border, ${isDark ? '#454545' : '#d4d4d4'}))`;
  const textColor = `var(--liminis-editor-menu-foreground, var(--vscode-menu-foreground, ${isDark ? '#cccccc' : '#333333'}))`;
  const hoverBg = `var(--liminis-editor-menu-selectionBackground, var(--vscode-menu-selectionBackground, ${isDark ? '#094771' : '#e8e8e8'}))`;
  const separatorColor = `var(--liminis-editor-menu-separatorBackground, var(--vscode-menu-separatorBackground, ${isDark ? '#454545' : '#d4d4d4'}))`;

  // Close on click outside or Escape
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
      {onEditText && (
        <button
          onClick={() => { onEditText(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          Edit text…
        </button>
      )}
      {onEditLayout && (
        <button
          onClick={() => { onEditLayout(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          {isEditingLayout ? 'Exit layout mode' : 'Edit layout'}
        </button>
      )}
      {onResetLayout && hasManualLayout && (
        <button
          onClick={() => { onResetLayout(); onClose(); }}
          style={{ ...itemStyle, color: textColor }}
          onMouseEnter={(e) => handleHover(e, true)}
          onMouseLeave={(e) => handleHover(e, false)}
        >
          Reset to auto layout
        </button>
      )}
      {(onEditText || onEditLayout) && (
        <div style={{ ...separatorStyle, background: separatorColor }} />
      )}
      <button
        onClick={onCopyImage}
        style={{ ...itemStyle, color: textColor }}
        onMouseEnter={(e) => handleHover(e, true)}
        onMouseLeave={(e) => handleHover(e, false)}
      >
        Copy image to clipboard
      </button>
    </div>
  );
}

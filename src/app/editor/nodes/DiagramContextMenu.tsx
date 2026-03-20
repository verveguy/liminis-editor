/**
 * Shared context menu overlay for diagram nodes (C4, Mermaid).
 * Provides "Copy image to clipboard" as a PNG.
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

/**
 * Context menu overlay component.
 */
export function DiagramContextMenu({
  visible,
  x,
  y,
  onCopyImage,
  onClose,
}: DiagramContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        background: 'var(--vscode-menu-background, #252526)',
        border: '1px solid var(--vscode-menu-border, #454545)',
        borderRadius: '6px',
        padding: '4px 0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: '180px',
      }}
    >
      <button
        onClick={onCopyImage}
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--vscode-menu-foreground, #cccccc)',
          fontSize: '13px',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.background = 'var(--vscode-menu-selectionBackground, #094771)';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.background = 'transparent';
        }}
      >
        Copy image to clipboard
      </button>
    </div>
  );
}

/**
 * useC4DiagramDrag - Hook for drag interaction on C4 diagram elements
 *
 * Provides drag-and-drop functionality for repositioning C4 diagram elements.
 * Uses window-level listeners during drag so the interaction continues even
 * when the cursor leaves the SVG bounds.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';

export interface UseC4DiagramDragProps {
  /** Reference to the SVG element */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Callback fired during drag with new position */
  onNodeDrag?: (nodeId: string, x: number, y: number) => void;
  /** Callback fired when drag ends */
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void;
  /** Whether drag interaction is enabled */
  enabled: boolean;
}

export interface UseC4DiagramDragReturn {
  /** ID of the node currently being dragged */
  draggedNodeId: string | null;
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** Start dragging a node */
  startNodeDrag: (nodeId: string, nodeX: number, nodeY: number, e: React.MouseEvent) => void;
  /** Convert screen coordinates to SVG coordinates */
  screenToSvg: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

/**
 * Hook for managing drag interactions on C4 diagram nodes.
 *
 * During a drag, mousemove and mouseup are handled on `window` so the
 * interaction continues seamlessly when the cursor moves outside the SVG.
 */
export function useC4DiagramDrag({
  svgRef,
  onNodeDrag,
  onNodeDragEnd,
  enabled,
}: UseC4DiagramDragProps): UseC4DiagramDragReturn {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  // Track the offset from cursor to node origin for smooth dragging
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Track the last known position for dragEnd callback
  const lastPositionRef = useRef({ x: 0, y: 0 });

  // Refs for callbacks so window listeners always see latest values
  const onNodeDragRef = useRef(onNodeDrag);
  onNodeDragRef.current = onNodeDrag;
  const onNodeDragEndRef = useRef(onNodeDragEnd);
  onNodeDragEndRef.current = onNodeDragEnd;
  const draggedNodeIdRef = useRef<string | null>(null);

  /**
   * Convert screen (client) coordinates to SVG coordinates.
   */
  const screenToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;

      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;

      const ctm = svg.getScreenCTM();
      if (!ctm) return null;

      const svgPoint = point.matrixTransform(ctm.inverse());
      return { x: svgPoint.x, y: svgPoint.y };
    },
    [svgRef]
  );

  const screenToSvgRef = useRef(screenToSvg);
  screenToSvgRef.current = screenToSvg;

  /**
   * Start dragging a node.
   */
  const startNodeDrag = useCallback(
    (nodeId: string, nodeX: number, nodeY: number, e: React.MouseEvent) => {
      if (!enabled) return;

      e.stopPropagation();
      e.preventDefault();

      const svgPoint = screenToSvg(e.clientX, e.clientY);
      if (!svgPoint) return;

      dragOffsetRef.current = {
        x: svgPoint.x - nodeX,
        y: svgPoint.y - nodeY,
      };

      lastPositionRef.current = { x: nodeX, y: nodeY };
      draggedNodeIdRef.current = nodeId;
      setDraggedNodeId(nodeId);
    },
    [enabled, screenToSvg]
  );

  // Attach window-level listeners while dragging
  useEffect(() => {
    if (!draggedNodeId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const nodeId = draggedNodeIdRef.current;
      if (!nodeId) return;

      const svgPoint = screenToSvgRef.current(e.clientX, e.clientY);
      if (!svgPoint) return;

      const newX = svgPoint.x - dragOffsetRef.current.x;
      const newY = svgPoint.y - dragOffsetRef.current.y;

      lastPositionRef.current = { x: newX, y: newY };
      onNodeDragRef.current?.(nodeId, newX, newY);
    };

    const handleMouseUp = () => {
      const nodeId = draggedNodeIdRef.current;
      if (!nodeId) return;

      onNodeDragEndRef.current?.(
        nodeId,
        lastPositionRef.current.x,
        lastPositionRef.current.y
      );
      draggedNodeIdRef.current = null;
      setDraggedNodeId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggedNodeId]);

  return {
    draggedNodeId,
    isDragging: draggedNodeId !== null,
    startNodeDrag,
    screenToSvg,
  };
}

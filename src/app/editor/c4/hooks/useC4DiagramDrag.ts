/**
 * useC4DiagramDrag - Hook for drag interaction on C4 diagram elements
 *
 * Provides drag-and-drop functionality for repositioning C4 diagram elements.
 * Follows patterns from useGraphInteractions for SVG coordinate conversion.
 */

import { useCallback, useRef, useState, RefObject } from 'react';

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
  /** Event handlers to attach to the SVG element */
  handlers: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
  };
  /** Convert screen coordinates to SVG coordinates */
  screenToSvg: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

/**
 * Hook for managing drag interactions on C4 diagram nodes.
 *
 * Usage:
 * ```tsx
 * const { draggedNodeId, startNodeDrag, handlers } = useC4DiagramDrag({
 *   svgRef,
 *   onNodeDrag: (nodeId, x, y) => updatePosition(nodeId, x, y),
 *   onNodeDragEnd: (nodeId, x, y) => persistPosition(nodeId, x, y),
 *   enabled: isEditMode,
 * });
 *
 * <svg ref={svgRef} {...handlers}>
 *   <g onMouseDown={(e) => startNodeDrag(nodeId, node.x, node.y, e)}>
 *     ...
 *   </g>
 * </svg>
 * ```
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

  /**
   * Convert screen (client) coordinates to SVG coordinates.
   * Uses the SVG's CTM (Current Transform Matrix) for accurate conversion
   * that accounts for viewBox and any transforms.
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

  /**
   * Start dragging a node.
   * Records the offset from cursor to node origin so the node
   * doesn't jump to center on the cursor.
   */
  const startNodeDrag = useCallback(
    (nodeId: string, nodeX: number, nodeY: number, e: React.MouseEvent) => {
      if (!enabled) return;

      e.stopPropagation();
      e.preventDefault();

      const svgPoint = screenToSvg(e.clientX, e.clientY);
      if (!svgPoint) return;

      // Calculate offset from cursor to node's top-left corner
      dragOffsetRef.current = {
        x: svgPoint.x - nodeX,
        y: svgPoint.y - nodeY,
      };

      lastPositionRef.current = { x: nodeX, y: nodeY };
      setDraggedNodeId(nodeId);
    },
    [enabled, screenToSvg]
  );

  /**
   * Handle mouse move during drag.
   * Updates node position via callback.
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggedNodeId || !enabled) return;

      const svgPoint = screenToSvg(e.clientX, e.clientY);
      if (!svgPoint) return;

      // Calculate new position accounting for drag offset
      const newX = svgPoint.x - dragOffsetRef.current.x;
      const newY = svgPoint.y - dragOffsetRef.current.y;

      lastPositionRef.current = { x: newX, y: newY };
      onNodeDrag?.(draggedNodeId, newX, newY);
    },
    [draggedNodeId, enabled, screenToSvg, onNodeDrag]
  );

  /**
   * Handle mouse up to end drag.
   */
  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (!draggedNodeId) return;

      onNodeDragEnd?.(
        draggedNodeId,
        lastPositionRef.current.x,
        lastPositionRef.current.y
      );
      setDraggedNodeId(null);
    },
    [draggedNodeId, onNodeDragEnd]
  );

  /**
   * Handle mouse leave to cancel drag gracefully.
   * Same behavior as mouse up - commits the last known position.
   */
  const handleMouseLeave = useCallback(
    (_e: React.MouseEvent) => {
      if (!draggedNodeId) return;

      onNodeDragEnd?.(
        draggedNodeId,
        lastPositionRef.current.x,
        lastPositionRef.current.y
      );
      setDraggedNodeId(null);
    },
    [draggedNodeId, onNodeDragEnd]
  );

  return {
    draggedNodeId,
    isDragging: draggedNodeId !== null,
    startNodeDrag,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
    },
    screenToSvg,
  };
}

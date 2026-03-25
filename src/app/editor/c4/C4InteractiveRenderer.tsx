/**
 * C4InteractiveRenderer - Interactive SVG renderer with drag support
 *
 * Wraps the C4Renderer with drag-and-drop functionality for manual layout mode.
 * Maintains local position state during drag and recalculates edges in real-time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C4RendererContent, computeLegendInfo } from './renderer';
import { layoutC4Diagram } from './layout';
import type { LayoutResult, LayoutNode, C4Diagram, C4Element } from './types';
import { useC4DiagramDrag } from './hooks/useC4DiagramDrag';

/** Synthetic ID used to store legend position in manual positions map */
export const LEGEND_POSITION_ID = '__legend__';

export interface C4InteractiveRendererProps {
  /** Parsed C4 diagram */
  diagram: C4Diagram;
  /** Whether dark mode is enabled */
  isDarkMode: boolean;
  /** Whether edit mode (drag) is enabled */
  isEditMode: boolean;
  /** Current manual positions */
  manualPositions: Record<string, { x: number; y: number }>;
  /** Callback when positions change (during drag or on drag end) */
  onPositionChange: (positions: Record<string, { x: number; y: number }>) => void;
}

/**
 * Collect all node IDs and their positions from the layout tree.
 */
function collectNodePositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    positions[node.id] = { x: node.x, y: node.y };
    if (node.children) {
      Object.assign(positions, collectNodePositions(node.children));
    }
  }
  return positions;
}

/**
 * Build a map from element ID to all its descendant IDs (recursive).
 */
function collectDescendantIds(elements: C4Element[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  function getDescendants(element: C4Element): string[] {
    const ids: string[] = [];
    for (const child of element.children) {
      ids.push(child.id);
      ids.push(...getDescendants(child));
    }
    return ids;
  }

  function visit(element: C4Element): void {
    const descendants = getDescendants(element);
    if (descendants.length > 0) {
      map.set(element.id, descendants);
    }
    for (const child of element.children) {
      visit(child);
    }
  }

  for (const element of elements) {
    visit(element);
  }

  return map;
}

/**
 * Interactive C4 diagram renderer with drag support.
 *
 * When isEditMode is true, nodes can be dragged to new positions.
 * Edges and boundaries are recalculated in real-time during drag.
 */
export function C4InteractiveRenderer({
  diagram,
  isDarkMode,
  isEditMode,
  manualPositions,
  onPositionChange,
}: C4InteractiveRendererProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);

  // Local positions during drag (merged with persisted positions)
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  // Ref mirror of dragPositions — always current, avoids stale closure in handleNodeDragEnd
  const dragPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // rAF handle for throttling drag updates
  const rafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  // Track drag start position for computing delta (used to move children)
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Map from element ID to its descendant IDs (for moving children with boundary)
  const descendantMap = useMemo(() => {
    return collectDescendantIds(diagram.elements);
  }, [diagram.elements]);

  // Compute the auto-layout once for seeding positions on first drag
  const autoLayout = useMemo(() => {
    return layoutC4Diagram(diagram);
  }, [diagram]);

  // Merge persisted positions with drag positions
  const effectivePositions = useMemo(() => ({
    ...manualPositions,
    ...dragPositions,
  }), [manualPositions, dragPositions]);

  // Compute layout using effective positions
  const layout = useMemo(() => {
    const hasPositions = Object.keys(effectivePositions).length > 0;
    return layoutC4Diagram(diagram, undefined, hasPositions ? effectivePositions : undefined);
  }, [diagram, effectivePositions]);

  /**
   * Apply drag delta to a node and all its descendants.
   * Returns an object with updated positions for the node and its children.
   */
  const applyDragWithChildren = useCallback((
    nodeId: string,
    x: number,
    y: number,
    basePositions: Record<string, { x: number; y: number }>,
  ): Record<string, { x: number; y: number }> => {
    const updates: Record<string, { x: number; y: number }> = { [nodeId]: { x, y } };

    const childIds = descendantMap.get(nodeId);
    if (childIds && dragStartPosRef.current) {
      const dx = x - dragStartPosRef.current.x;
      const dy = y - dragStartPosRef.current.y;
      for (const childId of childIds) {
        const childPos = basePositions[childId];
        if (childPos) {
          updates[childId] = { x: childPos.x + dx, y: childPos.y + dy };
        }
      }
    }

    return updates;
  }, [descendantMap]);

  // Snapshot of positions at drag start (before any delta is applied to children)
  const dragStartPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // Helper to update both drag state and ref mirror
  const updateDragPositions = useCallback((
    updater: (prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>
  ) => {
    setDragPositions(prev => {
      const next = updater(prev);
      dragPositionsRef.current = next;
      return next;
    });
  }, []);

  // Handle real-time position updates during drag, throttled to rAF
  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
    // On first move of a new drag, clear any stale positions from previous drag
    if (!dragStartPosRef.current && Object.keys(dragPositionsRef.current).length > 0) {
      dragPositionsRef.current = {};
      setDragPositions({});
    }

    pendingDragRef.current = { nodeId, x, y };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingDragRef.current;
        if (pending) {
          updateDragPositions(prev => {
            // On first drag, seed all node positions from current layout
            // to prevent other nodes from jumping to default placement
            if (Object.keys(prev).length === 0 && Object.keys(manualPositions).length === 0) {
              const seeded = collectNodePositions(autoLayout.nodes);
              // Record start positions for delta calculation
              if (!dragStartPosRef.current) {
                dragStartPosRef.current = seeded[pending.nodeId] ?? { x: pending.x, y: pending.y };
                dragStartPositionsRef.current = { ...seeded };
              }
              const updates = applyDragWithChildren(pending.nodeId, pending.x, pending.y, dragStartPositionsRef.current);
              return { ...seeded, ...updates };
            }

            // Record start position on first move if not already set
            if (!dragStartPosRef.current) {
              const currentPos = { ...manualPositions, ...prev };
              dragStartPosRef.current = currentPos[pending.nodeId] ?? { x: pending.x, y: pending.y };
              dragStartPositionsRef.current = { ...currentPos };
            }

            const updates = applyDragWithChildren(pending.nodeId, pending.x, pending.y, dragStartPositionsRef.current);
            return { ...prev, ...updates };
          });
        }
      });
    }
  }, [manualPositions, autoLayout.nodes, applyDragWithChildren, updateDragPositions]);

  // Handle drag end - persist positions
  // Uses dragPositionsRef (not dragPositions state) to avoid stale closure race
  const handleNodeDragEnd = useCallback((nodeId: string, x: number, y: number) => {
    // Cancel any pending rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Read latest drag positions from ref (immune to stale closure)
    const currentDragPositions = dragPositionsRef.current;

    // Merge all positions and persist
    const newPositions = {
      ...manualPositions,
      ...currentDragPositions,
    };

    // If this is the first drag, populate all other nodes with their current auto-layout positions
    if (Object.keys(manualPositions).length === 0) {
      const autoPositions = collectNodePositions(autoLayout.nodes);
      for (const [id, pos] of Object.entries(autoPositions)) {
        if (!newPositions[id]) {
          newPositions[id] = pos;
        }
      }
    }

    // Apply final position with children
    const basePositions = dragStartPositionsRef.current;
    const updates = applyDragWithChildren(nodeId, x, y, basePositions);
    Object.assign(newPositions, updates);

    onPositionChange(newPositions);
    // Don't clear dragPositions here — manualPositions hasn't absorbed the
    // new values yet (Lexical update listener is async). Clearing now would
    // cause effectivePositions to revert to stale manualPositions, producing
    // a visual snap-back. Instead, clear in the effect below when
    // manualPositions catches up.
    dragStartPosRef.current = null;
    dragStartPositionsRef.current = {};
  }, [manualPositions, autoLayout.nodes, onPositionChange, applyDragWithChildren]);

  // Set up drag hook (window-level listeners handle mousemove/mouseup)
  const { draggedNodeId, startNodeDrag } = useC4DiagramDrag({
    svgRef,
    onNodeDrag: handleNodeDrag,
    onNodeDragEnd: handleNodeDragEnd,
    enabled: isEditMode,
  });

  // Clear drag positions once manualPositions has absorbed the persisted values.
  // We verify absorption by comparing values — this avoids both:
  // - Clearing mid-drag (draggedNodeId guard)
  // - Clearing before Lexical propagates (value comparison)
  useEffect(() => {
    if (draggedNodeId || Object.keys(dragPositionsRef.current).length === 0) return;

    // Reset case: manualPositions was cleared (e.g., "Reset to Auto Layout")
    if (Object.keys(manualPositions).length === 0) {
      dragPositionsRef.current = {};
      setDragPositions({});
      return;
    }

    // Normal case: only clear once manualPositions contains the drag values
    const absorbed = Object.entries(dragPositionsRef.current).every(
      ([id, pos]) => {
        const mp = manualPositions[id];
        return mp?.x === pos.x && mp?.y === pos.y;
      }
    );
    if (absorbed) {
      dragPositionsRef.current = {};
      setDragPositions({});
    }
  }, [manualPositions, draggedNodeId]);

  // Compute legend info for hit area and position override
  const legendInfo = useMemo(() => computeLegendInfo(layout), [layout]);
  const legendPositionOverride = useMemo(() => {
    const pos = effectivePositions[LEGEND_POSITION_ID];
    return pos ?? null;
  }, [effectivePositions]);

  // Render with interactive wrappers
  return (
    <C4InteractiveSvg
      layout={layout}
      isDarkMode={isDarkMode}
      isEditMode={isEditMode}
      draggedNodeId={draggedNodeId}
      svgRef={svgRef}
      onNodeMouseDown={startNodeDrag}
      legendInfo={legendInfo}
      legendPositionOverride={legendPositionOverride}
    />
  );
}

interface C4InteractiveSvgProps {
  layout: LayoutResult;
  isDarkMode: boolean;
  isEditMode: boolean;
  draggedNodeId: string | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onNodeMouseDown: (nodeId: string, nodeX: number, nodeY: number, e: React.MouseEvent) => void;
  legendInfo: { x: number; y: number; width: number; height: number } | null;
  legendPositionOverride: { x: number; y: number } | null;
}

/**
 * SVG wrapper that adds interactive overlays for drag handling.
 */
function C4InteractiveSvg({
  layout,
  isDarkMode,
  isEditMode,
  draggedNodeId,
  svgRef,
  onNodeMouseDown,
  legendInfo,
  legendPositionOverride,
}: C4InteractiveSvgProps): JSX.Element {
  // Get colors based on theme
  const handleColor = isDarkMode ? '#a0a0a0' : '#505050';

  // Create hit areas for each node (and legend if present)
  const hitAreas = useMemo(() => {
    const areas: {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];

    function collectNodes(nodes: LayoutNode[]) {
      for (const node of nodes) {
        areas.push({
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        });
      }
    }

    collectNodes(layout.nodes);

    // Add legend as a draggable hit area
    if (legendInfo) {
      const lx = legendPositionOverride?.x ?? legendInfo.x;
      const ly = legendPositionOverride?.y ?? legendInfo.y;
      areas.push({
        id: LEGEND_POSITION_ID,
        x: lx,
        y: ly,
        width: legendInfo.width,
        height: legendInfo.height,
      });
    }

    return areas;
  }, [layout.nodes, legendInfo, legendPositionOverride]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Base renderer - use full rendered size including legend */}
      <svg
        ref={svgRef}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          cursor: isEditMode ? (draggedNodeId ? 'grabbing' : 'default') : 'default',
        }}
      >
        {/* Use the exported renderer content for stable API */}
        <C4RendererContent layout={layout} isDarkMode={isDarkMode} legendPositionOverride={legendPositionOverride} />

        {/* Overlay interactive hit areas in edit mode */}
        {isEditMode && (
          <g className="interactive-layer">
            {hitAreas.map((area) => (
              <rect
                key={area.id}
                data-node-id={area.id}
                x={area.x}
                y={area.y}
                width={area.width}
                height={area.height}
                fill="transparent"
                stroke="transparent"
                style={{
                  cursor: draggedNodeId === area.id ? 'grabbing' : 'grab',
                }}
                onMouseDown={(e) => onNodeMouseDown(area.id, area.x, area.y, e)}
              />
            ))}
          </g>
        )}

        {/* Drag handles in edit mode */}
        {isEditMode && (
          <g className="drag-handles-layer">
            {hitAreas.map((area) => (
              <DragHandle
                key={`handle-${area.id}`}
                x={area.x + area.width - 20}
                y={area.y + 4}
                color={handleColor}
                isDragging={draggedNodeId === area.id}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * Drag handle indicator (grip icon).
 */
function DragHandle({
  x,
  y,
  color,
  isDragging,
}: {
  x: number;
  y: number;
  color: string;
  isDragging: boolean;
}): JSX.Element {
  const opacity = isDragging ? 0.8 : 0.4;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      opacity={opacity}
      style={{ pointerEvents: 'none' }}
    >
      {/* Grip vertical icon - 3 rows of 2 circles */}
      <circle cx={4} cy={4} r={1.5} fill={color} />
      <circle cx={12} cy={4} r={1.5} fill={color} />
      <circle cx={4} cy={8} r={1.5} fill={color} />
      <circle cx={12} cy={8} r={1.5} fill={color} />
      <circle cx={4} cy={12} r={1.5} fill={color} />
      <circle cx={12} cy={12} r={1.5} fill={color} />
    </g>
  );
}

export default C4InteractiveRenderer;

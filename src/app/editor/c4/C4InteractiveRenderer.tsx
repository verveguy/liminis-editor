/**
 * C4InteractiveRenderer - Interactive SVG renderer with drag support
 *
 * Wraps the C4Renderer with drag-and-drop functionality for manual layout mode.
 * Maintains local position state during drag and recalculates edges in real-time.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { C4RendererContent } from './renderer';
import { layoutC4Diagram } from './layout';
import type { LayoutResult, LayoutNode, C4Diagram } from './types';
import { useC4DiagramDrag } from './hooks/useC4DiagramDrag';

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

  // rAF handle for throttling drag updates
  const rafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

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

  // Handle real-time position updates during drag, throttled to rAF
  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
    pendingDragRef.current = { nodeId, x, y };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingDragRef.current;
        if (pending) {
          setDragPositions(prev => {
            // On first drag, seed all node positions from current layout
            // to prevent other nodes from jumping to default placement
            if (Object.keys(prev).length === 0 && Object.keys(manualPositions).length === 0) {
              const seeded = collectNodePositions(autoLayout.nodes);
              seeded[pending.nodeId] = { x: pending.x, y: pending.y };
              return seeded;
            }
            return {
              ...prev,
              [pending.nodeId]: { x: pending.x, y: pending.y },
            };
          });
        }
      });
    }
  }, [manualPositions, autoLayout.nodes]);

  // Handle drag end - persist positions
  const handleNodeDragEnd = useCallback((nodeId: string, x: number, y: number) => {
    // Cancel any pending rAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Merge all positions and persist
    const newPositions = {
      ...manualPositions,
      ...dragPositions,
      [nodeId]: { x, y },
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

    onPositionChange(newPositions);
    setDragPositions({});
  }, [manualPositions, dragPositions, autoLayout.nodes, onPositionChange]);

  // Set up drag hook
  const { draggedNodeId, startNodeDrag, handlers } = useC4DiagramDrag({
    svgRef,
    onNodeDrag: handleNodeDrag,
    onNodeDragEnd: handleNodeDragEnd,
    enabled: isEditMode,
  });

  // Render with interactive wrappers
  return (
    <C4InteractiveSvg
      layout={layout}
      isDarkMode={isDarkMode}
      isEditMode={isEditMode}
      draggedNodeId={draggedNodeId}
      svgRef={svgRef}
      handlers={handlers}
      onNodeMouseDown={startNodeDrag}
    />
  );
}

interface C4InteractiveSvgProps {
  layout: LayoutResult;
  isDarkMode: boolean;
  isEditMode: boolean;
  draggedNodeId: string | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  handlers: {
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseUp: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
  };
  onNodeMouseDown: (nodeId: string, nodeX: number, nodeY: number, e: React.MouseEvent) => void;
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
  handlers,
  onNodeMouseDown,
}: C4InteractiveSvgProps): JSX.Element {
  // Get colors based on theme
  const handleColor = isDarkMode ? '#a0a0a0' : '#505050';

  // Create hit areas for each node
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
        // Don't add hit areas for children - they're positioned relative to parent
        // and already have absolute positions in the flattened layout
      }
    }

    collectNodes(layout.nodes);
    return areas;
  }, [layout.nodes]);

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
        {...handlers}
      >
        {/* Use the exported renderer content for stable API */}
        <C4RendererContent layout={layout} isDarkMode={isDarkMode} />

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

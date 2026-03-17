/**
 * C4 Layout Engine
 *
 * Uses @dagrejs/dagre for directed graph auto-layout of C4 architecture diagrams.
 * Supports nested elements (systems containing containers containing components)
 * with proper boundary group padding.
 */

import dagre from '@dagrejs/dagre';
import type {
  C4Diagram,
  C4Element,
  C4Direction,
  LayoutResult,
  LayoutNode,
  LayoutEdge,
  LayoutOptions,
  Point,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 240,
  nodeHeight: 80,
  nodePadding: 30,
  rankSep: 100,
  edgeSep: 25,
};

/** Padding around boundary group contents */
const BOUNDARY_PADDING = 40;

/** Space reserved for boundary header (title + optional tech badge) */
const BOUNDARY_HEADER_HEIGHT = 55;

/** Additional height for elements with tech badges or descriptions */
const TECH_BADGE_HEIGHT = 16;
const DESCRIPTION_HEIGHT = 14;

/** Person element dimensions */
const PERSON_WIDTH = 120;
const PERSON_HEIGHT = 100;

// =============================================================================
// DIMENSION CALCULATIONS
// =============================================================================

/**
 * Calculate node dimensions based on element content.
 * Accounts for name length, tech badge, and description text.
 */
function calculateNodeDimensions(
  element: C4Element,
  options: Required<LayoutOptions>
): { width: number; height: number } {
  // Person elements have fixed smaller size
  if (element.type === 'person') {
    return { width: PERSON_WIDTH, height: PERSON_HEIGHT };
  }

  // Start with base dimensions
  let width = options.nodeWidth;
  let height = options.nodeHeight;

  // Estimate width based on name length (roughly 9px per character)
  const nameWidth = element.name.length * 9 + 48;
  width = Math.max(width, nameWidth);

  // Add height for tech badge if present
  if (element.properties.tech) {
    height += TECH_BADGE_HEIGHT;
    // Account for [] brackets around tech text
    const techWidth = (element.properties.tech.length + 2) * 7 + 48;
    width = Math.max(width, techWidth);
  }

  // Add height for description if present
  if (element.properties.description) {
    height += DESCRIPTION_HEIGHT;
    // Description wraps, so limit width contribution
    const descWidth = Math.min(element.properties.description.length * 7, 360);
    width = Math.max(width, descWidth);
  }

  // Cylinder shapes are slightly taller
  if (element.properties.shape === 'cylinder') {
    height += 20;
  }

  // Queue shapes need extra width for the wavy right edge
  if (element.properties.shape === 'queue') {
    width += 20;
  }

  return { width, height };
}

// =============================================================================
// DAGRE DIRECTION MAPPING
// =============================================================================

/**
 * Map C4 direction to dagre rankdir.
 */
function mapDirection(direction: C4Direction | undefined): 'TB' | 'BT' | 'LR' | 'RL' {
  switch (direction) {
    case 'down':
      return 'TB'; // Top to Bottom
    case 'up':
      return 'BT'; // Bottom to Top
    case 'left':
      return 'RL'; // Right to Left
    case 'right':
      return 'LR'; // Left to Right
    default:
      return 'TB'; // Top to Bottom (C4 convention)
  }
}

// =============================================================================
// LAYOUT CALCULATION
// =============================================================================

/**
 * Build element lookup map for quick access.
 */
function buildElementMap(elements: C4Element[]): Map<string, C4Element> {
  const map = new Map<string, C4Element>();
  for (const element of elements) {
    map.set(element.id, element);
  }
  return map;
}

/**
 * Get top-level elements (elements without parents).
 */
function getTopLevelElements(elements: C4Element[]): C4Element[] {
  return elements.filter((e) => !e.parent);
}

/**
 * Layout a group of elements using dagre.
 * Returns positioned nodes with their children recursively laid out.
 */
function layoutGroup(
  elements: C4Element[],
  relationships: { sourceId: string; targetId: string; label: string }[],
  options: Required<LayoutOptions>,
  elementMap: Map<string, C4Element>,
  parentDirection?: C4Direction
): LayoutNode[] {
  if (elements.length === 0) {
    return [];
  }

  // Create dagre graph
  const g = new dagre.graphlib.Graph();

  // Determine layout direction from parent or use default
  const direction = parentDirection || 'down';

  g.setGraph({
    rankdir: mapDirection(direction),
    nodesep: options.nodePadding,
    ranksep: options.rankSep,
    edgesep: options.edgeSep,
    marginx: BOUNDARY_PADDING,
    marginy: BOUNDARY_PADDING,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Map to store layout nodes for building result
  const layoutNodes = new Map<string, LayoutNode>();

  // Add nodes to graph
  for (const element of elements) {
    // First, recursively layout children if any
    let childNodes: LayoutNode[] = [];
    let childBounds = { width: 0, height: 0 };

    if (element.children.length > 0) {
      // Get child direction from this element, or inherit from parent
      const childDirection = element.properties.direction || parentDirection;

      // Filter relationships that are between children of this element
      const childIds = new Set(element.children.map((c) => c.id));
      const childRelationships = relationships.filter(
        (r) => childIds.has(r.sourceId) && childIds.has(r.targetId)
      );

      childNodes = layoutGroup(
        element.children,
        childRelationships,
        options,
        elementMap,
        childDirection
      );

      // Calculate bounding box of children
      if (childNodes.length > 0) {
        const maxX = Math.max(...childNodes.map((n) => n.x + n.width));
        const maxY = Math.max(...childNodes.map((n) => n.y + n.height));
        childBounds = {
          width: maxX + BOUNDARY_PADDING,
          height: maxY + BOUNDARY_PADDING,
        };
      }
    }

    // Calculate this node's dimensions
    const baseDimensions = calculateNodeDimensions(element, options);

    // If this is a boundary/system with children, use child bounds
    const isBoundary =
      element.type === 'system' ||
      element.properties.style === 'boundary' ||
      element.children.length > 0;

    const nodeWidth = isBoundary
      ? Math.max(baseDimensions.width, childBounds.width)
      : baseDimensions.width;

    const nodeHeight = isBoundary
      ? Math.max(baseDimensions.height, childBounds.height + BOUNDARY_HEADER_HEIGHT)
      : baseDimensions.height;

    // Add to dagre graph
    g.setNode(element.id, { width: nodeWidth, height: nodeHeight });

    // Store preliminary layout node
    layoutNodes.set(element.id, {
      id: element.id,
      x: 0,
      y: 0,
      width: nodeWidth,
      height: nodeHeight,
      element,
      children: childNodes,
    });
  }

  // Add edges to graph (only those between elements in this group)
  const elementIds = new Set(elements.map((e) => e.id));
  for (const rel of relationships) {
    if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
      g.setEdge(rel.sourceId, rel.targetId);
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract positions from dagre
  const result: LayoutNode[] = [];

  for (const element of elements) {
    const dagreNode = g.node(element.id);
    const layoutNode = layoutNodes.get(element.id)!;

    // Dagre gives center coordinates, convert to top-left
    layoutNode.x = dagreNode.x - dagreNode.width / 2;
    layoutNode.y = dagreNode.y - dagreNode.height / 2;

    // Offset children to be inside parent boundary
    if (layoutNode.children && layoutNode.children.length > 0) {
      const offsetX = layoutNode.x + BOUNDARY_PADDING;
      const offsetY = layoutNode.y + BOUNDARY_HEADER_HEIGHT;

      for (const child of layoutNode.children) {
        offsetLayoutNode(child, offsetX, offsetY);
      }
    }

    result.push(layoutNode);
  }

  return result;
}

/**
 * Recursively offset a layout node and its children.
 */
function offsetLayoutNode(node: LayoutNode, offsetX: number, offsetY: number): void {
  node.x += offsetX;
  node.y += offsetY;

  if (node.children) {
    for (const child of node.children) {
      offsetLayoutNode(child, offsetX, offsetY);
    }
  }
}

/**
 * Flatten layout nodes into a single array including all nested children.
 */
function flattenLayoutNodes(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];

  function visit(node: LayoutNode): void {
    result.push(node);
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  for (const node of nodes) {
    visit(node);
  }

  return result;
}

/**
 * Calculate edge paths between elements.
 * Uses center points with simple routing.
 */
function calculateEdges(
  relationships: { sourceId: string; targetId: string; label: string }[],
  nodeMap: Map<string, LayoutNode>
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const rel of relationships) {
    const sourceNode = nodeMap.get(rel.sourceId);
    const targetNode = nodeMap.get(rel.targetId);

    if (!sourceNode || !targetNode) {
      continue;
    }

    // Calculate center points
    const sourceCenter: Point = {
      x: sourceNode.x + sourceNode.width / 2,
      y: sourceNode.y + sourceNode.height / 2,
    };

    const targetCenter: Point = {
      x: targetNode.x + targetNode.width / 2,
      y: targetNode.y + targetNode.height / 2,
    };

    // Calculate edge points from node boundaries
    const sourcePoint = calculateEdgePoint(sourceNode, targetCenter);
    const targetPoint = calculateEdgePoint(targetNode, sourceCenter);

    edges.push({
      source: rel.sourceId,
      target: rel.targetId,
      points: [sourcePoint, targetPoint],
      label: rel.label,
    });
  }

  return edges;
}

/**
 * Calculate the point where an edge exits/enters a rectangular node.
 */
function calculateEdgePoint(node: LayoutNode, target: Point): Point {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;

  // Vector from center to target
  const dx = target.x - centerX;
  const dy = target.y - centerY;

  // Handle edge case of same position
  if (dx === 0 && dy === 0) {
    return { x: centerX, y: centerY };
  }

  // Calculate intersection with rectangle boundary
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;

  // Check which edge we intersect
  const scaleX = halfWidth / Math.abs(dx || 0.001);
  const scaleY = halfHeight / Math.abs(dy || 0.001);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Layout a C4 diagram using dagre for auto-positioning.
 *
 * @param diagram - The parsed C4 diagram AST
 * @param options - Layout configuration options
 * @returns Layout result with positioned nodes and routed edges
 */
export function layoutC4Diagram(
  diagram: C4Diagram,
  options?: LayoutOptions
): LayoutResult {
  const mergedOptions: Required<LayoutOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const elementMap = buildElementMap(diagram.elements);
  const topLevelElements = getTopLevelElements(diagram.elements);

  // Layout top-level elements
  const layoutNodes = layoutGroup(
    topLevelElements,
    diagram.relationships,
    mergedOptions,
    elementMap
  );

  // Flatten all nodes for the result
  const allNodes = flattenLayoutNodes(layoutNodes);

  // Build node lookup for edge calculation
  const nodeMap = new Map<string, LayoutNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
  }

  // Calculate edges
  const edges = calculateEdges(diagram.relationships, nodeMap);

  // Calculate total diagram dimensions
  let width = 0;
  let height = 0;

  for (const node of allNodes) {
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }

  // Add margin
  width += BOUNDARY_PADDING;
  height += BOUNDARY_PADDING;

  return {
    nodes: allNodes,
    edges,
    width,
    height,
  };
}

/**
 * Re-export types for convenience.
 */
export type { LayoutResult, LayoutNode, LayoutEdge, LayoutOptions, Point };

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

/** Gap between a boundary and external elements outside it */
const EXTERNAL_GAP = 80;

/** Space reserved for boundary header (title + optional tech badge) */
const BOUNDARY_HEADER_HEIGHT = 55;

/** Additional height for elements with tech badges or descriptions */
const TECH_BADGE_HEIGHT = 16;
const DESCRIPTION_HEIGHT = 14;

/** Person element dimensions */
const PERSON_WIDTH = 120;
const PERSON_HEIGHT = 120;

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
  // Use label length to influence minimum edge length so labels have room
  const elementIds = new Set(elements.map((e) => e.id));
  for (const rel of relationships) {
    if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
      // Longer labels need more space between ranks
      const labelLen = rel.label?.length ?? 0;
      const minlen = labelLen > 30 ? 2 : 1;
      g.setEdge(rel.sourceId, rel.targetId, { minlen });
    }
  }

  // Add virtual edges between boundaries when their children have relationships.
  // This gives dagre the rank ordering it needs (e.g., macOS above Cloud Services
  // when Graphiti Service → Neo4j AuraDB crosses that boundary).
  // Map every descendant to its top-level ancestor in this group
  const childToParent = new Map<string, string>();
  function mapDescendants(element: C4Element, topAncestor: string): void {
    for (const child of element.children) {
      childToParent.set(child.id, topAncestor);
      mapDescendants(child, topAncestor);
    }
  }
  for (const element of elements) {
    mapDescendants(element, element.id);
  }

  const virtualEdges = new Set<string>();
  for (const rel of relationships) {
    const sourceParent = childToParent.get(rel.sourceId);
    const targetParent = childToParent.get(rel.targetId);
    if (sourceParent && targetParent && sourceParent !== targetParent) {
      const key = `${sourceParent}->${targetParent}`;
      if (!virtualEdges.has(key)) {
        virtualEdges.add(key);
        g.setEdge(sourceParent, targetParent);
      }
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

    // Offset children to be centered inside parent boundary
    if (layoutNode.children && layoutNode.children.length > 0) {
      // Calculate children's actual bounding box (dagre may not start at 0)
      const childMinX = Math.min(...layoutNode.children.map((n) => n.x));
      const childMaxX = Math.max(...layoutNode.children.map((n) => n.x + n.width));
      const childrenWidth = childMaxX - childMinX;

      // Center children horizontally within parent
      const availableWidth = layoutNode.width - BOUNDARY_PADDING * 2;
      const centerOffsetX = (availableWidth - childrenWidth) / 2;

      const offsetX = layoutNode.x + BOUNDARY_PADDING + Math.max(0, centerOffsetX) - childMinX;
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

  // Count parallel edges between the same pair (in either direction)
  const pairCounts = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const rel of relationships) {
    const key = [rel.sourceId, rel.targetId].sort().join('::');
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  for (const rel of relationships) {
    const sourceNode = nodeMap.get(rel.sourceId);
    const targetNode = nodeMap.get(rel.targetId);

    if (!sourceNode || !targetNode) {
      continue;
    }

    // Determine offset for parallel edges
    const pairKey = [rel.sourceId, rel.targetId].sort().join('::');
    const totalParallel = pairCounts.get(pairKey) ?? 1;
    const currentIndex = pairIndex.get(pairKey) ?? 0;
    pairIndex.set(pairKey, currentIndex + 1);

    // Calculate center points
    const sourceCenter: Point = {
      x: sourceNode.x + sourceNode.width / 2,
      y: sourceNode.y + sourceNode.height / 2,
    };

    const targetCenter: Point = {
      x: targetNode.x + targetNode.width / 2,
      y: targetNode.y + targetNode.height / 2,
    };

    // Calculate edge points from node boundaries (unoffset)
    const sourcePoint = calculateEdgePoint(sourceNode, targetCenter);
    const targetPoint = calculateEdgePoint(targetNode, sourceCenter);

    // For parallel edges, offset both points perpendicular to the edge
    if (totalParallel > 1) {
      const dx = targetCenter.x - sourceCenter.x;
      const dy = targetCenter.y - sourceCenter.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const perpX = -dy / len;
        const perpY = dx / len;
        const spread = 25;
        const offset = (currentIndex - (totalParallel - 1) / 2) * spread;
        sourcePoint.x += perpX * offset;
        sourcePoint.y += perpY * offset;
        targetPoint.x += perpX * offset;
        targetPoint.y += perpY * offset;
      }
    }

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
// CROSS-BOUNDARY ALIGNMENT
// =============================================================================

/**
 * After layout, nudge non-boundary top-level elements toward their
 * cross-boundary relationship targets, without overlapping boundaries.
 *
 * For example, if "Knowledge Worker" relates to "MCP Host" inside a boundary,
 * shift "Knowledge Worker" toward "MCP Host"'s X position, but don't let it
 * overlap the boundary rectangle.
 */
function alignCrossBoundaryElements(
  topLevelNodes: LayoutNode[],
  relationships: { sourceId: string; targetId: string; label: string }[],
  nodeMap: Map<string, LayoutNode>
): void {
  const leafNodes = topLevelNodes.filter(
    (n) => !n.children || n.children.length === 0
  );
  const boundaryNodes = topLevelNodes.filter(
    (n) => n.children && n.children.length > 0
  );

  if (leafNodes.length === 0 || boundaryNodes.length === 0) return;

  // Step 1: Align each leaf's Y with its primary cross-boundary target,
  // and nudge X toward the boundary edge nearest to the target
  for (const leaf of leafNodes) {
    const targets: { x: number; y: number }[] = [];

    for (const rel of relationships) {
      let partnerId: string | undefined;
      if (rel.sourceId === leaf.id) partnerId = rel.targetId;
      else if (rel.targetId === leaf.id) partnerId = rel.sourceId;
      else continue;

      const partner = nodeMap.get(partnerId);
      if (!partner || !partner.element.parent) continue;

      targets.push({
        x: partner.x + partner.width / 2,
        y: partner.y + partner.height / 2,
      });
    }

    if (targets.length === 0) continue;

    // Align Y with the average target Y (center the leaf vertically)
    const avgTargetY = targets.reduce((s, t) => s + t.y, 0) / targets.length;
    leaf.y = avgTargetY - leaf.height / 2;

    // Nudge X: keep leaf outside boundaries but closer to its targets
    const avgTargetX = targets.reduce((s, t) => s + t.x, 0) / targets.length;
    const currentCenterX = leaf.x + leaf.width / 2;
    const nudgedCenterX = currentCenterX + (avgTargetX - currentCenterX) * 0.3;
    leaf.x = nudgedCenterX - leaf.width / 2;
  }

  // Step 2: Ensure leaves don't overlap boundaries
  for (const leaf of leafNodes) {
    const originalCenterX = leaf.x + leaf.width / 2;

    for (const boundary of boundaryNodes) {
      const leafRight = leaf.x + leaf.width;
      const leafLeft = leaf.x;
      const yOverlap =
        leaf.y < boundary.y + boundary.height + BOUNDARY_PADDING &&
        leaf.y + leaf.height + BOUNDARY_PADDING > boundary.y;

      if (yOverlap && leafRight > boundary.x - EXTERNAL_GAP && leafLeft < boundary.x + boundary.width + EXTERNAL_GAP) {
        if (originalCenterX < boundary.x + boundary.width / 2) {
          leaf.x = boundary.x - leaf.width - EXTERNAL_GAP;
        } else {
          leaf.x = boundary.x + boundary.width + EXTERNAL_GAP;
        }
      }
    }
  }

  // Step 3: Resolve leaf-to-leaf overlaps by pushing apart vertically
  leafNodes.sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < leafNodes.length; i++) {
    for (let j = i + 1; j < leafNodes.length; j++) {
      const a = leafNodes[i];
      const b = leafNodes[j];

      const gap = BOUNDARY_PADDING;
      const xOverlap = a.x < b.x + b.width + gap &&
                        a.x + a.width + gap > b.x;
      const yOverlap = a.y < b.y + b.height + gap &&
                        a.y + a.height + gap > b.y;

      if (xOverlap && yOverlap) {
        b.y = a.y + a.height + gap;
      }
    }
  }

  // Step 4: Align peer leaves on the same side of a boundary to share X
  // Group leaves by which side of which boundary they're on
  for (const boundary of boundaryNodes) {
    const boundaryCenterX = boundary.x + boundary.width / 2;
    const leftPeers = leafNodes.filter((n) => n.x + n.width / 2 < boundaryCenterX);
    const rightPeers = leafNodes.filter((n) => n.x + n.width / 2 >= boundaryCenterX);

    // Align left peers to the same X (use the maximum X so none overlap boundary)
    if (leftPeers.length > 1) {
      const alignX = Math.min(...leftPeers.map((n) => n.x));
      for (const peer of leftPeers) {
        peer.x = alignX;
      }
    }

    // Align right peers to the same X (closest to boundary, not furthest)
    if (rightPeers.length > 1) {
      const alignX = Math.min(...rightPeers.map((n) => n.x));
      // Ensure it's still outside the boundary
      const minX = boundary.x + boundary.width + EXTERNAL_GAP;
      for (const peer of rightPeers) {
        peer.x = Math.max(alignX, minX);
      }
    }
  }

  // Step 5: Re-resolve overlaps after peer alignment may have re-introduced them
  leafNodes.sort((a, b) => a.y - b.y || a.x - b.x);

  for (let i = 0; i < leafNodes.length; i++) {
    for (let j = i + 1; j < leafNodes.length; j++) {
      const a = leafNodes[i];
      const b = leafNodes[j];

      const gap = BOUNDARY_PADDING;
      const xOverlap = a.x < b.x + b.width + gap &&
                        a.x + a.width + gap > b.x;
      const yOverlap = a.y < b.y + b.height + gap &&
                        a.y + a.height + gap > b.y;

      if (xOverlap && yOverlap) {
        b.y = a.y + a.height + gap;
      }
    }
  }
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

  const topLevelElements = getTopLevelElements(diagram.elements);

  // Layout top-level elements
  const layoutNodes = layoutGroup(
    topLevelElements,
    diagram.relationships,
    mergedOptions
  );

  // Flatten all nodes for the result
  const allNodes = flattenLayoutNodes(layoutNodes);

  // Build node lookup for edge calculation
  const nodeMap = new Map<string, LayoutNode>();
  for (const node of allNodes) {
    nodeMap.set(node.id, node);
  }

  // Post-layout: align non-boundary elements with their cross-boundary targets
  alignCrossBoundaryElements(layoutNodes, diagram.relationships, nodeMap);

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

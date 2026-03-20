/**
 * C4 SVG Renderer (Canonical)
 *
 * Pure React component that renders C4 architecture diagrams as SVG.
 * This is the single authoritative renderer — used in the editor (via C4Node)
 * and for headless SVG generation (via renderToStaticMarkup for publishing).
 *
 * Features:
 * - All C4 element types (person, system, container, component)
 * - All shapes (rectangle, cylinder, queue)
 * - Boundary nesting with alternating fills
 * - Edge labels with line clipping, rotation, and multi-line support
 * - Step number labels (circled) and legend ref labels (squared)
 * - Smart legend placement for long/parallel labels
 * - Light and dark theme support
 */

import type { LayoutResult, LayoutNode, LayoutEdge, Point } from './types';
import { buildClippedEdgePaths } from './edge-clipping';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Colors for light mode (matches imperative renderer — white fills, colored strokes) */
const LIGHT_COLORS = {
  containerFill: 'oklch(1.00 0.00 0)',
  componentFill: 'oklch(0.98 0.00 0)',
  externalFill: 'oklch(0.96 0.01 240)',
  personFill: 'oklch(0.45 0.16 152)',
  boundaryFill: 'oklch(0.98 0.01 240)',
  containerStroke: 'oklch(0.45 0.15 240)',
  componentStroke: 'oklch(0.50 0.12 240)',
  externalStroke: 'oklch(0.55 0.02 240)',
  personStroke: 'oklch(0.35 0.16 152)',
  boundaryStroke: 'oklch(0.60 0.05 240)',
  edgeStroke: 'oklch(0.35 0.00 0)',
  textPrimary: 'oklch(0.20 0.00 0)',
  textSecondary: 'oklch(0.40 0.00 0)',
  textOnBoundary: 'oklch(0.25 0.00 0)',
  edgeLabel: 'oklch(0.30 0.00 0)',
  edgeLabelBackground: 'oklch(1.00 0.00 0)',
};

/** Colors for dark mode */
const DARK_COLORS = {
  containerFill: 'oklch(0.20 0.01 240)',
  componentFill: 'oklch(0.20 0.01 240)',
  externalFill: 'oklch(0.18 0.00 0)',
  personFill: 'oklch(0.45 0.16 152)',
  boundaryFill: 'oklch(0.15 0.01 240)',
  containerStroke: 'oklch(0.65 0.15 240)',
  componentStroke: 'oklch(0.60 0.12 240)',
  externalStroke: 'oklch(0.55 0.02 240)',
  personStroke: 'oklch(0.60 0.16 152)',
  boundaryStroke: 'oklch(0.50 0.05 240)',
  edgeStroke: 'oklch(0.70 0.00 0)',
  textPrimary: 'oklch(0.90 0.00 0)',
  textSecondary: 'oklch(0.75 0.00 0)',
  textOnBoundary: 'oklch(0.90 0.00 0)',
  edgeLabel: 'oklch(0.80 0.00 0)',
  edgeLabelBackground: 'oklch(0.20 0.01 240)',
};

type Colors = typeof LIGHT_COLORS;

const BORDER_RADIUS = 8;
const PERSON_HEAD_RADIUS = 14;
const PERSON_BODY_WIDTH = 40;
const PERSON_BODY_HEIGHT = 30;
const NAME_FONT_SIZE = 14;
const TECH_FONT_SIZE = 11;
const DESCRIPTION_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const ARROW_SIZE = 8;
const LEGEND_ROW_HEIGHT = 24;
const LEGEND_MARGIN = 20;
const STEP_NUMBER_PATTERN = /^(\d+)\s*\[(.+)\]$/;
const LEGEND_THRESHOLD = 50;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getColors(isDarkMode: boolean): Colors {
  return isDarkMode ? DARK_COLORS : LIGHT_COLORS;
}

function calculateArrowheadPoints(startPoint: Point, endPoint: Point): string {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const tipX = endPoint.x;
  const tipY = endPoint.y;
  const baseX = endPoint.x - ux * ARROW_SIZE;
  const baseY = endPoint.y - uy * ARROW_SIZE;
  const halfW = ARROW_SIZE * 0.5;
  return `${tipX},${tipY} ${baseX + px * halfW},${baseY + py * halfW} ${baseX - px * halfW},${baseY - py * halfW}`;
}

function shortenEdgeEnd(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const result = [...points];
  const lastIndex = result.length - 1;
  const secondLastIndex = lastIndex - 1;
  const dx = result[lastIndex].x - result[secondLastIndex].x;
  const dy = result[lastIndex].y - result[secondLastIndex].y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > ARROW_SIZE) {
    const ratio = (len - ARROW_SIZE) / len;
    result[lastIndex] = {
      x: result[secondLastIndex].x + dx * ratio,
      y: result[secondLastIndex].y + dy * ratio,
    };
  }
  return result;
}

/**
 * Split an edge label into lines for rendering.
 * If the label contains a [technology] suffix, always put it on its own line.
 * Otherwise, break long labels at a natural word boundary near the middle.
 */
function splitEdgeLabel(label: string): string[] {
  const techMatch = /^(.+?)\s*(\[.+\])$/.exec(label);
  if (techMatch) {
    return [techMatch[1].trim(), techMatch[2]];
  }
  const LINE_BREAK_THRESHOLD = 30;
  if (label.length > LINE_BREAK_THRESHOLD) {
    const mid = Math.floor(label.length / 2);
    let breakIdx = label.lastIndexOf(' ', mid + 10);
    if (breakIdx < mid - 15 || breakIdx === -1) breakIdx = label.indexOf(' ', mid - 5);
    if (breakIdx === -1) breakIdx = mid;
    return [label.slice(0, breakIdx).trim(), label.slice(breakIdx).trim()];
  }
  return [label];
}

/** Compute nesting depth for alternating boundary fills */
function getNestingDepth(element: LayoutNode['element'], allNodes: LayoutNode[]): number {
  let depth = 0;
  let parentId = element.parent;
  while (parentId) {
    depth++;
    const parentNode = allNodes.find((n) => n.id === parentId);
    parentId = parentNode?.element.parent;
  }
  return depth;
}

// =============================================================================
// LEGEND PRE-PROCESSING
// =============================================================================

interface LegendEntry {
  index: string;
  label: string;
  isStep: boolean;
}

interface ProcessedEdge extends LayoutEdge {
  isLegendRef: boolean;
  isStepNumber: boolean;
  displayLabel?: string;
}

function processEdgesForLegend(edges: LayoutEdge[]): {
  edges: ProcessedEdge[];
  legendEntries: LegendEntry[];
} {
  const legendEntries: LegendEntry[] = [];
  let nextLetterIndex = 0;
  const nextLetter = () => String.fromCharCode(65 + (nextLetterIndex++ % 26));

  const processed: ProcessedEdge[] = edges.map((edge) => {
    if (!edge.label) return { ...edge, isLegendRef: false, isStepNumber: false };

    const stepMatch = STEP_NUMBER_PATTERN.exec(edge.label);
    if (stepMatch) {
      const stepNum = stepMatch[1];
      const description = stepMatch[2];
      legendEntries.push({ index: stepNum, label: description, isStep: true });
      const showInline = description.length <= LEGEND_THRESHOLD;
      return {
        ...edge,
        label: stepNum,
        displayLabel: showInline ? description : undefined,
        isLegendRef: true,
        isStepNumber: true,
      };
    }

    if (edge.label.length > LEGEND_THRESHOLD) {
      const letter = nextLetter();
      legendEntries.push({ index: letter, label: edge.label, isStep: false });
      return { ...edge, label: letter, isLegendRef: true, isStepNumber: false };
    }
    return { ...edge, isLegendRef: false, isStepNumber: false };
  });

  // If multiple edges between same pair, or any one is in legend,
  // move ALL edges in that pair to legend
  const pairCounts = new Map<string, number>();
  for (const edge of processed) {
    if (edge.label) {
      const key = [edge.source, edge.target].sort().join('::');
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }
  const pairNeedsLegend = new Map<string, boolean>();
  for (const edge of processed) {
    const key = [edge.source, edge.target].sort().join('::');
    if (edge.isLegendRef || (pairCounts.get(key) ?? 0) > 1) {
      pairNeedsLegend.set(key, true);
    }
  }
  for (const edge of processed) {
    if (!edge.isLegendRef && edge.label) {
      const key = [edge.source, edge.target].sort().join('::');
      if (pairNeedsLegend.get(key)) {
        const letter = nextLetter();
        legendEntries.push({ index: letter, label: edge.label, isStep: false });
        edge.label = letter;
        edge.isLegendRef = true;
      }
    }
  }

  return { edges: processed, legendEntries };
}

// =============================================================================
// LEGEND PLACEMENT
// =============================================================================

function computeLegendPlacement(
  legendEntries: LegendEntry[],
  layout: LayoutResult,
): { x: number; y: number; width: number; height: number; totalWidth: number; totalHeight: number } {
  const longestLabel = Math.max(...legendEntries.map((e) => e.label.length), 0);
  const legendW = Math.min(longestLabel * 6 + 40, 400);
  const legendH = legendEntries.length * LEGEND_ROW_HEIGHT + LEGEND_MARGIN;
  const margin = LEGEND_MARGIN;
  const allNodes = layout.nodes;

  function overlapsNodes(rx: number, ry: number, rw: number, rh: number): boolean {
    for (const node of allNodes) {
      if (rx < node.x + node.width + margin &&
          rx + rw + margin > node.x &&
          ry < node.y + node.height + margin &&
          ry + rh + margin > node.y) {
        return true;
      }
    }
    return false;
  }

  const step = 30;
  let bestPlacement: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const allowOverflow = legendW;

  for (let cy = margin; cy <= layout.height - legendH - margin; cy += step) {
    for (let cx = margin; cx <= layout.width + allowOverflow - legendW; cx += step) {
      if (!overlapsNodes(cx, cy, legendW, legendH)) {
        const withinX = cx + legendW <= layout.width;
        const withinY = cy + legendH <= layout.height;
        const withinBonus = (withinX ? 50 : 0) + (withinY ? 50 : 0);
        const overflowX = Math.max(0, (cx + legendW) - layout.width);
        const overflowY = Math.max(0, (cy + legendH) - layout.height);
        const overflowPenalty = (overflowX + overflowY) * 0.5;
        const score = withinBonus +
          (cx / (layout.width || 1)) * 30 +
          ((1 - cy / (layout.height || 1)) * 20) -
          overflowPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestPlacement = { x: cx, y: cy };
        }
      }
    }
  }

  for (const node of allNodes) {
    const cx = node.x + node.width + margin;
    const cy = node.y;
    if (!overlapsNodes(cx, cy, legendW, legendH)) {
      const withinX = cx + legendW <= layout.width;
      const withinY = cy + legendH <= layout.height;
      const withinBonus = (withinX ? 50 : 0) + (withinY ? 50 : 0);
      const overflowX = Math.max(0, (cx + legendW) - layout.width);
      const overflowY = Math.max(0, (cy + legendH) - layout.height);
      const overflowPenalty = (overflowX + overflowY) * 0.5;
      const score = withinBonus +
        (cx / (layout.width || 1)) * 30 +
        ((1 - cy / (layout.height || 1)) * 20) -
        overflowPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestPlacement = { x: cx, y: cy };
      }
    }
  }

  if (!bestPlacement) {
    bestPlacement = { x: margin, y: layout.height + margin };
  }

  let totalWidth = layout.width;
  let totalHeight = layout.height;
  if (bestPlacement.x + legendW + margin > totalWidth) {
    totalWidth = bestPlacement.x + legendW + margin;
  }
  if (bestPlacement.y + legendH + margin > totalHeight) {
    totalHeight = bestPlacement.y + legendH + margin;
  }

  return {
    x: bestPlacement.x,
    y: bestPlacement.y,
    width: legendW,
    height: legendH,
    totalWidth,
    totalHeight,
  };
}

// =============================================================================
// SVG ELEMENT RENDERERS
// =============================================================================

interface ElementProps {
  node: LayoutNode;
  colors: Colors;
  allNodes: LayoutNode[];
}

function SystemBoundary({ node, colors, allNodes }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = element.properties.external === true;
  const hasChildren = (node.children?.length ?? 0) > 0 || element.properties.style === 'boundary';
  const depth = getNestingDepth(element, allNodes);
  const boundaryFillColor = depth % 2 === 0 ? colors.boundaryFill : colors.containerFill;

  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        rx={BORDER_RADIUS} ry={BORDER_RADIUS}
        fill={isExt ? colors.externalFill : hasChildren ? boundaryFillColor : colors.containerFill}
        stroke={isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke}
        strokeWidth={2.5}
        strokeDasharray={(isExt || hasChildren) ? '8 4' : 'none'}
      />
      <text
        x={x + width / 2}
        y={hasChildren ? y + 24 : y + height / 2 - (element.properties.tech ? 6 : 0) - (element.properties.description ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline={hasChildren ? undefined : 'middle'}
        fill={hasChildren ? colors.textOnBoundary : colors.textPrimary}
        fontSize={NAME_FONT_SIZE} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.tech && (
        <text
          x={x + width / 2}
          y={hasChildren ? y + 40 : y + height / 2 + 10 - (element.properties.description ? 6 : 0)}
          textAnchor="middle"
          fill={hasChildren ? colors.textOnBoundary : colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
      {element.properties.description && !hasChildren && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (element.properties.tech ? 26 : 14)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 50
            ? element.properties.description.slice(0, 47) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

function Container({ node, colors, allNodes }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = element.properties.external === true;
  const hasChildren = (node.children?.length ?? 0) > 0 || element.properties.style === 'boundary';

  if (element.properties.shape === 'cylinder') {
    return <CylinderShape node={node} colors={colors} allNodes={allNodes} />;
  }
  if (element.properties.shape === 'queue') {
    return <QueueShape node={node} colors={colors} allNodes={allNodes} />;
  }

  const depth = getNestingDepth(element, allNodes);
  const boundaryFillColor = depth % 2 === 0 ? colors.boundaryFill : colors.containerFill;
  const fill = isExt ? colors.externalFill : hasChildren ? boundaryFillColor : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke;
  const textColor = hasChildren ? colors.textOnBoundary : colors.textPrimary;
  const textY = hasChildren
    ? y + 24
    : y + height / 2 - (element.properties.tech ? 6 : 0) - (element.properties.description ? 6 : 0);

  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        rx={BORDER_RADIUS} ry={BORDER_RADIUS}
        fill={fill} stroke={stroke}
        strokeWidth={2.5}
        strokeDasharray={(isExt || hasChildren) ? '8 4' : 'none'}
      />
      <text
        x={x + width / 2} y={textY}
        textAnchor="middle"
        dominantBaseline={hasChildren ? undefined : 'middle'}
        fill={textColor}
        fontSize={NAME_FONT_SIZE} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.tech && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10 - (element.properties.description ? 6 : 0)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
      {element.properties.description && !hasChildren && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (element.properties.tech ? 26 : 14)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 50
            ? element.properties.description.slice(0, 47) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

function CylinderShape({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = element.properties.external === true;
  const ellipseRy = 12;
  const bodyY = y + ellipseRy;
  const bodyHeight = height - ellipseRy * 2;
  const fill = isExt ? colors.externalFill : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : colors.containerStroke;

  return (
    <g>
      <rect x={x} y={bodyY} width={width} height={bodyHeight}
        fill={fill} stroke={stroke} strokeWidth={2.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      <ellipse cx={x + width / 2} cy={y + height - ellipseRy}
        rx={width / 2} ry={ellipseRy}
        fill={fill} stroke={stroke} strokeWidth={2.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      <ellipse cx={x + width / 2} cy={y + ellipseRy}
        rx={width / 2} ry={ellipseRy}
        fill={fill} stroke={stroke} strokeWidth={2.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      <text
        x={x + width / 2} y={y + height / 2 - (element.properties.tech ? 6 : 0)}
        textAnchor="middle" dominantBaseline="middle"
        fill={colors.textPrimary} fontSize={NAME_FONT_SIZE} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.tech && (
        <text x={x + width / 2} y={y + height / 2 + 12}
          textAnchor="middle" fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE} fontFamily="system-ui, -apple-system, sans-serif" opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
    </g>
  );
}

function QueueShape({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = element.properties.external === true;
  const fill = isExt ? colors.externalFill : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : colors.containerStroke;
  const ellipseRx = 16;

  return (
    <g>
      <rect x={x + ellipseRx} y={y} width={width - ellipseRx * 2} height={height}
        fill={fill} stroke={fill}
      />
      <ellipse cx={x + ellipseRx} cy={y + height / 2}
        rx={ellipseRx} ry={height / 2}
        fill={fill} stroke={stroke} strokeWidth={2.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      <ellipse cx={x + width - ellipseRx} cy={y + height / 2}
        rx={ellipseRx} ry={height / 2}
        fill={fill} stroke={stroke} strokeWidth={2.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      <line x1={x + ellipseRx} y1={y} x2={x + width - ellipseRx} y2={y}
        stroke={stroke} strokeWidth={2.5}
      />
      <line x1={x + ellipseRx} y1={y + height} x2={x + width - ellipseRx} y2={y + height}
        stroke={stroke} strokeWidth={2.5}
      />
      <text
        x={x + width / 2} y={y + height / 2 - (element.properties.tech ? 6 : 0)}
        textAnchor="middle" dominantBaseline="middle"
        fill={colors.textPrimary} fontSize={NAME_FONT_SIZE} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.tech && (
        <text x={x + width / 2} y={y + height / 2 + 12}
          textAnchor="middle" fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE} fontFamily="system-ui, -apple-system, sans-serif" opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
      {element.properties.description && (
        <text x={x + width / 2} y={y + height / 2 + (element.properties.tech ? 26 : 14)}
          textAnchor="middle" fill={colors.textSecondary}
          fontSize={DESCRIPTION_FONT_SIZE} fontFamily="system-ui, -apple-system, sans-serif" opacity={0.7}
        >
          {element.properties.description.length > 50
            ? element.properties.description.slice(0, 47) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

function Component({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height}
        rx={BORDER_RADIUS / 2} ry={BORDER_RADIUS / 2}
        fill={colors.componentFill} stroke={colors.componentStroke} strokeWidth={2.5}
      />
      <text
        x={x + width / 2} y={y + height / 2 - (element.properties.tech ? 4 : 0)}
        textAnchor="middle" dominantBaseline="middle"
        fill={colors.textPrimary}
        fontSize={NAME_FONT_SIZE - 1} fontWeight="500"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.tech && (
        <text
          x={x + width / 2} y={y + height / 2 + 12}
          textAnchor="middle" fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE - 1}
          fontFamily="system-ui, -apple-system, sans-serif" opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
    </g>
  );
}

function Person({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const centerX = x + width / 2;
  const iconY = y + 12;

  return (
    <g>
      <circle
        cx={centerX} cy={iconY + PERSON_HEAD_RADIUS} r={PERSON_HEAD_RADIUS}
        fill={colors.personFill} stroke={colors.personStroke} strokeWidth={1.5}
      />
      <rect
        x={centerX - PERSON_BODY_WIDTH / 2} y={iconY + PERSON_HEAD_RADIUS * 2 + 4}
        width={PERSON_BODY_WIDTH} height={PERSON_BODY_HEIGHT}
        rx={PERSON_BODY_WIDTH / 2} ry={8}
        fill={colors.personFill} stroke={colors.personStroke} strokeWidth={1.5}
      />
      <text
        x={centerX} y={y + height - 18}
        textAnchor="middle" fill={colors.textOnBoundary}
        fontSize={NAME_FONT_SIZE} fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {element.properties.description && (
        <text
          x={centerX} y={y + height - 4}
          textAnchor="middle" fill={colors.textOnBoundary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif" opacity={0.7}
        >
          {element.properties.description.length > 20
            ? element.properties.description.slice(0, 17) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

// =============================================================================
// EDGE RENDERER
// =============================================================================

interface EdgeComponentProps {
  edge: ProcessedEdge;
  colors: Colors;
}

function EdgeComponent({ edge, colors }: EdgeComponentProps): JSX.Element {
  const { points, label } = edge;
  if (points.length < 2) return <></>;

  const shortenedPoints = shortenEdgeEnd(points);
  const arrowPoints = calculateArrowheadPoints(
    shortenedPoints[shortenedPoints.length - 1],
    points[points.length - 1]
  );

  const midpoint: Point = {
    x: (points[0].x + points[points.length - 1].x) / 2,
    y: (points[0].y + points[points.length - 1].y) / 2,
  };
  const edgeDx = points[points.length - 1].x - points[0].x;
  const edgeDy = points[points.length - 1].y - points[0].y;

  let angleDeg = Math.atan2(edgeDy, edgeDx) * (180 / Math.PI);
  if (angleDeg > 90) angleDeg -= 180;
  if (angleDeg < -90) angleDeg += 180;
  if (Math.abs(angleDeg) > 60) angleDeg = 0;

  const labelX = midpoint.x;
  const labelY = midpoint.y;
  const labelTransform = `rotate(${angleDeg}, ${labelX}, ${labelY})`;

  // Compute edge paths with label clipping
  let edgePaths: string[];
  if (label) {
    if (edge.isStepNumber || edge.isLegendRef) {
      // Clip around the circle/square shape
      const shapeR = 10;
      const pad = 2;
      edgePaths = buildClippedEdgePaths(
        shortenedPoints,
        { x: labelX, y: labelY },
        shapeR + pad,
        shapeR + pad,
        0
      );
    } else {
      // Clip around text label
      const lines = splitEdgeLabel(label);
      const longestLine = lines.reduce((a, b) => (a.length > b.length ? a : b), '');
      const avgCharWidth = EDGE_LABEL_FONT_SIZE * 0.55;
      const halfW = (longestLine.length * avgCharWidth) / 2 + 3;
      const lineHeight = 14;
      const ascent = EDGE_LABEL_FONT_SIZE * 0.8;
      const descent = EDGE_LABEL_FONT_SIZE * 0.2;
      const pad = 3;

      let clipTop: number;
      let clipBottom: number;
      if (lines.length === 1) {
        const baseline = labelY + 4;
        clipTop = baseline - ascent - pad;
        clipBottom = baseline + descent + pad;
      } else {
        const firstBaseline = labelY - ((lines.length - 1) * lineHeight) / 2;
        const lastBaseline = firstBaseline + (lines.length - 1) * lineHeight;
        clipTop = firstBaseline - ascent - pad;
        clipBottom = lastBaseline + descent + pad;
      }

      const clipCenterY = (clipTop + clipBottom) / 2;
      const halfH = (clipBottom - clipTop) / 2;

      edgePaths = buildClippedEdgePaths(
        shortenedPoints,
        { x: labelX, y: clipCenterY },
        halfW,
        halfH,
        angleDeg
      );
    }
  } else {
    edgePaths = [shortenedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')];
  }

  // Render label content
  let labelContent: JSX.Element | null = null;
  if (label) {
    if (edge.isStepNumber || edge.isLegendRef) {
      labelContent = (
        <>
          {edge.isStepNumber ? (
            <circle cx={labelX} cy={labelY} r={10}
              fill={colors.edgeLabelBackground} stroke={colors.edgeStroke} strokeWidth={1.5}
            />
          ) : (
            <rect x={labelX - 10} y={labelY - 10} width={20} height={20} rx={3}
              fill={colors.edgeLabelBackground} stroke={colors.edgeStroke} strokeWidth={1.5}
            />
          )}
          <text x={labelX} y={labelY + 4}
            textAnchor="middle" fill={colors.edgeStroke}
            fontSize={10} fontWeight="600"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {label}
          </text>
          {edge.isStepNumber && edge.displayLabel && (
            <text x={labelX} y={labelY - 16}
              textAnchor="middle" fill={colors.edgeLabel}
              fontSize={EDGE_LABEL_FONT_SIZE}
              fontFamily="system-ui, -apple-system, sans-serif"
              transform={labelTransform}
            >
              {edge.displayLabel}
            </text>
          )}
        </>
      );
    } else {
      const lines = splitEdgeLabel(label);
      const lineHeight = 14;
      const startY = lines.length === 1
        ? labelY + 4
        : labelY - ((lines.length - 1) * lineHeight) / 2;

      labelContent = (
        <text x={labelX} textAnchor="middle"
          fill={colors.edgeLabel} fontSize={EDGE_LABEL_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          transform={labelTransform}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={labelX} y={startY + i * lineHeight}>{line}</tspan>
          ))}
        </text>
      );
    }
  }

  return (
    <g>
      {edgePaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={colors.edgeStroke} strokeWidth={1.5} />
      ))}
      {arrowPoints && <polygon points={arrowPoints} fill={colors.edgeStroke} />}
      {labelContent}
    </g>
  );
}

// =============================================================================
// LEGEND RENDERER
// =============================================================================

function Legend({ entries, placement, colors }: {
  entries: LegendEntry[];
  placement: { x: number; y: number };
  colors: Colors;
}): JSX.Element {
  const circleR = 9;
  let currentY = placement.y + circleR + 4;

  return (
    <g className="legend-layer">
      {entries.map((entry, i) => {
        const symbolCenterX = placement.x + circleR;
        const symbolCenterY = currentY - 4;
        const textY = currentY;
        currentY += LEGEND_ROW_HEIGHT;

        return (
          <g key={i}>
            {entry.isStep ? (
              <circle cx={symbolCenterX} cy={symbolCenterY} r={circleR}
                fill={colors.edgeLabelBackground} stroke={colors.edgeStroke} strokeWidth={1.5}
              />
            ) : (
              <rect
                x={symbolCenterX - circleR} y={symbolCenterY - circleR}
                width={circleR * 2} height={circleR * 2} rx={3}
                fill={colors.edgeLabelBackground} stroke={colors.edgeStroke} strokeWidth={1.5}
              />
            )}
            <text x={symbolCenterX} y={textY}
              textAnchor="middle" fill={colors.edgeStroke}
              fontSize={10} fontWeight="600"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {entry.index}
            </text>
            <text x={placement.x + circleR * 2 + 8} y={textY}
              fill={colors.edgeLabel} fontSize={11}
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {entry.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// =============================================================================
// NODE RENDERER DISPATCHER
// =============================================================================

function renderNode(node: LayoutNode, colors: Colors, allNodes: LayoutNode[]): JSX.Element {
  const { element } = node;
  switch (element.type) {
    case 'system':
      return <SystemBoundary key={node.id} node={node} colors={colors} allNodes={allNodes} />;
    case 'container':
      return <Container key={node.id} node={node} colors={colors} allNodes={allNodes} />;
    case 'component':
      return <Component key={node.id} node={node} colors={colors} allNodes={allNodes} />;
    case 'person':
      return <Person key={node.id} node={node} colors={colors} allNodes={allNodes} />;
    default:
      return <Container key={node.id} node={node} colors={colors} allNodes={allNodes} />;
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export interface C4RendererProps {
  /** Layout result from the layout engine */
  layout: LayoutResult;
  /** Whether dark mode is enabled */
  isDarkMode: boolean;
}

/**
 * C4 Diagram SVG Renderer.
 *
 * Pure component: takes layout + theme, returns SVG.
 * Used directly in the editor and via renderToStaticMarkup for publishing.
 */
export function C4Renderer({ layout, isDarkMode }: C4RendererProps): JSX.Element {
  const colors = getColors(isDarkMode);

  const boundaryNodes = layout.nodes.filter(
    (n) =>
      n.element.type === 'system' &&
      ((n.children?.length ?? 0) > 0 || n.element.properties.style === 'boundary')
  );
  const regularNodes = layout.nodes.filter(
    (n) =>
      !(
        n.element.type === 'system' &&
        ((n.children?.length ?? 0) > 0 || n.element.properties.style === 'boundary')
      )
  );

  const { edges: processedEdges, legendEntries } = processEdgesForLegend(layout.edges);

  let totalWidth = layout.width;
  let totalHeight = layout.height;
  let legendPlacement: { x: number; y: number } | null = null;

  if (legendEntries.length > 0) {
    const lp = computeLegendPlacement(legendEntries, layout);
    legendPlacement = { x: lp.x, y: lp.y };
    totalWidth = lp.totalWidth;
    totalHeight = lp.totalHeight;
  }

  return (
    <svg
      width={totalWidth}
      height={totalHeight}
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      <g className="boundaries-layer">
        {boundaryNodes.map((node) => renderNode(node, colors, layout.nodes))}
      </g>
      <g className="nodes-layer">
        {regularNodes.map((node) => renderNode(node, colors, layout.nodes))}
      </g>
      <g className="edges-layer">
        {processedEdges.map((edge, i) => (
          <EdgeComponent
            key={`${edge.source}-${edge.target}-${i}`}
            edge={edge}
            colors={colors}
          />
        ))}
      </g>
      {legendPlacement && legendEntries.length > 0 && (
        <Legend entries={legendEntries} placement={legendPlacement} colors={colors} />
      )}
    </svg>
  );
}

// =============================================================================
// ERROR DISPLAY
// =============================================================================

export interface C4ErrorDisplayProps {
  errors: { message: string; line: number; column: number }[];
  isDarkMode: boolean;
}

export function C4ErrorDisplay({ errors, isDarkMode }: C4ErrorDisplayProps): JSX.Element {
  const errorColor = isDarkMode ? 'oklch(0.70 0.20 25)' : 'oklch(0.55 0.25 25)';
  const bgColor = isDarkMode ? 'oklch(0.20 0.02 25)' : 'oklch(0.95 0.02 25)';
  const textColor = isDarkMode ? 'oklch(0.85 0.00 0)' : 'oklch(0.25 0.00 0)';

  return (
    <div
      style={{
        padding: '1rem',
        backgroundColor: bgColor,
        borderRadius: '8px',
        border: `1px solid ${errorColor}`,
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
      }}
    >
      <div style={{ color: errorColor, fontWeight: 600, marginBottom: '0.5rem' }}>
        C4 Diagram Parse Error
      </div>
      {errors.map((error, i) => (
        <div key={i} style={{ color: textColor, marginBottom: '0.25rem' }}>
          Line {error.line}, Column {error.column}: {error.message}
        </div>
      ))}
    </div>
  );
}

export default C4Renderer;

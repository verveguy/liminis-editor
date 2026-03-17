/**
 * C4 SVG Renderer
 *
 * React component that renders C4 architecture diagrams as SVG.
 * Takes a LayoutResult from the layout engine and produces a visual diagram.
 */

import type { LayoutResult, LayoutNode, LayoutEdge, Point } from './types';
import { isExternal, isBoundary } from './types';

// =============================================================================
// CONSTANTS - OKLCH Color Palette
// =============================================================================

/** Colors for light mode */
const LIGHT_COLORS = {
  // Element fills
  containerFill: 'oklch(0.62 0.15 240)', // Blue similar to #438DD5
  componentFill: 'oklch(0.70 0.12 240)', // Lighter blue for components
  externalFill: 'oklch(0.75 0.02 240)', // Grey for external systems
  personFill: 'oklch(0.55 0.16 152)', // Green for persons
  boundaryFill: 'oklch(0.97 0.01 240)', // Very light grey for boundaries

  // Strokes
  containerStroke: 'oklch(0.45 0.15 240)', // Darker blue stroke
  componentStroke: 'oklch(0.55 0.12 240)', // Component stroke
  externalStroke: 'oklch(0.55 0.02 240)', // Grey stroke
  personStroke: 'oklch(0.40 0.16 152)', // Darker green stroke
  boundaryStroke: 'oklch(0.60 0.05 240)', // Light grey dashed stroke
  edgeStroke: 'oklch(0.40 0.00 0)', // Neutral grey for edges

  // Text
  textPrimary: 'oklch(0.98 0.00 0)', // White text on filled elements
  textSecondary: 'oklch(0.90 0.00 0)', // Slightly dimmer text
  textOnBoundary: 'oklch(0.25 0.00 0)', // Dark text on light boundary
  edgeLabel: 'oklch(0.30 0.00 0)', // Dark text for edge labels
  edgeLabelBackground: 'oklch(1.00 0.00 0)', // White background for edge labels

  // Background
  background: 'transparent',
};

/** Colors for dark mode */
const DARK_COLORS = {
  // Element fills
  containerFill: 'oklch(0.50 0.15 240)', // Darker blue
  componentFill: 'oklch(0.55 0.12 240)', // Component fill
  externalFill: 'oklch(0.45 0.02 240)', // Darker grey
  personFill: 'oklch(0.45 0.16 152)', // Darker green
  boundaryFill: 'oklch(0.20 0.01 240)', // Dark boundary fill

  // Strokes
  containerStroke: 'oklch(0.65 0.15 240)', // Lighter blue stroke in dark mode
  componentStroke: 'oklch(0.70 0.12 240)', // Component stroke
  externalStroke: 'oklch(0.60 0.02 240)', // Grey stroke
  personStroke: 'oklch(0.60 0.16 152)', // Lighter green stroke
  boundaryStroke: 'oklch(0.50 0.05 240)', // Boundary stroke
  edgeStroke: 'oklch(0.70 0.00 0)', // Lighter grey for edges in dark mode

  // Text
  textPrimary: 'oklch(0.98 0.00 0)', // White text
  textSecondary: 'oklch(0.85 0.00 0)', // Slightly dimmer
  textOnBoundary: 'oklch(0.90 0.00 0)', // Light text on dark boundary
  edgeLabel: 'oklch(0.85 0.00 0)', // Light text for edge labels
  edgeLabelBackground: 'oklch(0.25 0.01 240)', // Dark background for edge labels

  // Background
  background: 'transparent',
};

/** Border radius for rounded rectangles */
const BORDER_RADIUS = 8;

/** Person icon dimensions */
const PERSON_HEAD_RADIUS = 14;
const PERSON_BODY_WIDTH = 40;
const PERSON_BODY_HEIGHT = 30;

/** Text styling */
const NAME_FONT_SIZE = 14;
const TECH_FONT_SIZE = 11;
const DESCRIPTION_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;

/** Arrowhead size */
const ARROW_SIZE = 8;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the color palette based on theme.
 */
function getColors(isDarkMode: boolean) {
  return isDarkMode ? DARK_COLORS : LIGHT_COLORS;
}

/**
 * Calculate arrowhead polygon points for an edge.
 * Based on GraphLink.tsx pattern.
 */
function calculateArrowheadPoints(
  startPoint: Point,
  endPoint: Point
): string {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return '';

  // Unit vector along the edge
  const ux = dx / len;
  const uy = dy / len;

  // Perpendicular vector
  const px = -uy;
  const py = ux;

  // Tip at endPoint, base set back by ARROW_SIZE
  const tipX = endPoint.x;
  const tipY = endPoint.y;
  const baseX = endPoint.x - ux * ARROW_SIZE;
  const baseY = endPoint.y - uy * ARROW_SIZE;
  const halfW = ARROW_SIZE * 0.5;

  return `${tipX},${tipY} ${baseX + px * halfW},${baseY + py * halfW} ${baseX - px * halfW},${baseY - py * halfW}`;
}

/**
 * Calculate the midpoint of an edge for label placement.
 */
function getEdgeMidpoint(points: Point[]): Point {
  if (points.length < 2) {
    return points[0] || { x: 0, y: 0 };
  }
  // Use the midpoint between first and last point
  return {
    x: (points[0].x + points[points.length - 1].x) / 2,
    y: (points[0].y + points[points.length - 1].y) / 2,
  };
}

/**
 * Shorten edge endpoint to leave room for arrowhead.
 */
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

// =============================================================================
// SVG ELEMENT RENDERERS
// =============================================================================

interface ElementProps {
  node: LayoutNode;
  colors: typeof LIGHT_COLORS;
}

/**
 * Render a system boundary (dotted-line rounded rectangle).
 */
function SystemBoundary({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = isExternal(element);
  const hasBoundaryStyle = isBoundary(element);

  // Systems with children or boundary style get special treatment
  const hasChildren = (node.children?.length ?? 0) > 0 || hasBoundaryStyle;

  return (
    <g>
      {/* Background rectangle */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={BORDER_RADIUS}
        ry={BORDER_RADIUS}
        fill={isExt ? colors.externalFill : hasChildren ? colors.boundaryFill : colors.containerFill}
        stroke={isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke}
        strokeWidth={isExt || hasChildren ? 2 : 1.5}
        strokeDasharray={isExt || hasChildren ? '8 4' : 'none'}
      />
      {/* Name label at top */}
      <text
        x={x + width / 2}
        y={y + 24}
        textAnchor="middle"
        fill={hasChildren ? colors.textOnBoundary : colors.textPrimary}
        fontSize={NAME_FONT_SIZE}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Tech badge */}
      {element.properties.tech && (
        <text
          x={x + width / 2}
          y={y + 40}
          textAnchor="middle"
          fill={hasChildren ? colors.textOnBoundary : colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
      {/* Description */}
      {element.properties.description && !hasChildren && (
        <text
          x={x + width / 2}
          y={y + (element.properties.tech ? 56 : 42)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 35
            ? element.properties.description.slice(0, 32) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

/**
 * Render a container (solid filled rectangle with tech badge).
 */
function Container({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = isExternal(element);
  const isCylinder = element.properties.shape === 'cylinder';
  const isQueue = element.properties.shape === 'queue';

  if (isCylinder) {
    return <CylinderShape node={node} colors={colors} />;
  }

  if (isQueue) {
    return <QueueShape node={node} colors={colors} />;
  }

  return (
    <g>
      {/* Background rectangle */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={BORDER_RADIUS}
        ry={BORDER_RADIUS}
        fill={isExt ? colors.externalFill : colors.containerFill}
        stroke={isExt ? colors.externalStroke : colors.containerStroke}
        strokeWidth={isExt ? 2 : 1.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      {/* Name label */}
      <text
        x={x + width / 2}
        y={y + height / 2 - (element.properties.tech ? 6 : 0) - (element.properties.description ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={colors.textPrimary}
        fontSize={NAME_FONT_SIZE}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Tech badge */}
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
      {/* Description */}
      {element.properties.description && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (element.properties.tech ? 26 : 14)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 35
            ? element.properties.description.slice(0, 32) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

/**
 * Render a cylinder shape (for databases).
 */
function CylinderShape({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = isExternal(element);

  // Cylinder dimensions
  const ellipseRy = 12;
  const bodyY = y + ellipseRy;
  const bodyHeight = height - ellipseRy * 2;

  return (
    <g>
      {/* Cylinder body */}
      <rect
        x={x}
        y={bodyY}
        width={width}
        height={bodyHeight}
        fill={isExt ? colors.externalFill : colors.containerFill}
        stroke={isExt ? colors.externalStroke : colors.containerStroke}
        strokeWidth={isExt ? 2 : 1.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      {/* Bottom ellipse */}
      <ellipse
        cx={x + width / 2}
        cy={y + height - ellipseRy}
        rx={width / 2}
        ry={ellipseRy}
        fill={isExt ? colors.externalFill : colors.containerFill}
        stroke={isExt ? colors.externalStroke : colors.containerStroke}
        strokeWidth={isExt ? 2 : 1.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      {/* Top ellipse (on top) */}
      <ellipse
        cx={x + width / 2}
        cy={y + ellipseRy}
        rx={width / 2}
        ry={ellipseRy}
        fill={isExt ? colors.externalFill : colors.containerFill}
        stroke={isExt ? colors.externalStroke : colors.containerStroke}
        strokeWidth={isExt ? 2 : 1.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      {/* Name label */}
      <text
        x={x + width / 2}
        y={y + height / 2 - (element.properties.tech ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={colors.textPrimary}
        fontSize={NAME_FONT_SIZE}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Tech badge */}
      {element.properties.tech && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 12}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
    </g>
  );
}

/**
 * Render a queue shape (rectangle with wavy right edge for message queues).
 */
function QueueShape({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const isExt = isExternal(element);
  const waveDepth = 10;
  const r = BORDER_RADIUS;
  const fill = isExt ? colors.externalFill : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : colors.containerStroke;

  // Path: rounded left corners, wavy right edge
  const pathD = [
    `M ${x + r} ${y}`,
    `L ${x + width - waveDepth} ${y}`,
    `C ${x + width + waveDepth * 0.3} ${y + height * 0.25}, ${x + width - waveDepth * 1.3} ${y + height * 0.5}, ${x + width - waveDepth} ${y + height * 0.5}`,
    `C ${x + width - waveDepth * 0.7} ${y + height * 0.5}, ${x + width + waveDepth * 0.3} ${y + height * 0.75}, ${x + width - waveDepth} ${y + height}`,
    `L ${x + r} ${y + height}`,
    `Q ${x} ${y + height}, ${x} ${y + height - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y}, ${x + r} ${y}`,
    'Z',
  ].join(' ');

  const textCenterX = x + (width - waveDepth) / 2;

  return (
    <g>
      <path
        d={pathD}
        fill={fill}
        stroke={stroke}
        strokeWidth={isExt ? 2 : 1.5}
        strokeDasharray={isExt ? '8 4' : 'none'}
      />
      {/* Name label */}
      <text
        x={textCenterX}
        y={y + height / 2 - (element.properties.tech ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={colors.textPrimary}
        fontSize={NAME_FONT_SIZE}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Tech badge */}
      {element.properties.tech && (
        <text
          x={textCenterX}
          y={y + height / 2 + 12}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
      {/* Description */}
      {element.properties.description && (
        <text
          x={textCenterX}
          y={y + height / 2 + (element.properties.tech ? 26 : 14)}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 35
            ? element.properties.description.slice(0, 32) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

/**
 * Render a component (smaller rectangle within a container).
 */
function Component({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;

  return (
    <g>
      {/* Background rectangle */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={BORDER_RADIUS / 2}
        ry={BORDER_RADIUS / 2}
        fill={colors.componentFill}
        stroke={colors.componentStroke}
        strokeWidth={1}
      />
      {/* Name label */}
      <text
        x={x + width / 2}
        y={y + height / 2 - (element.properties.tech ? 4 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={colors.textPrimary}
        fontSize={NAME_FONT_SIZE - 1}
        fontWeight="500"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Tech badge */}
      {element.properties.tech && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 12}
          textAnchor="middle"
          fill={colors.textSecondary}
          fontSize={TECH_FONT_SIZE - 1}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.8}
        >
          [{element.properties.tech}]
        </text>
      )}
    </g>
  );
}

/**
 * Render a person (SVG icon shape).
 */
function Person({ node, colors }: ElementProps): JSX.Element {
  const { x, y, width, height, element } = node;
  const centerX = x + width / 2;

  // Icon positioning - person icon at top, name below
  const iconY = y + 12;

  return (
    <g>
      {/* Person head (circle) */}
      <circle
        cx={centerX}
        cy={iconY + PERSON_HEAD_RADIUS}
        r={PERSON_HEAD_RADIUS}
        fill={colors.personFill}
        stroke={colors.personStroke}
        strokeWidth={1.5}
      />
      {/* Person body (rounded rectangle) */}
      <rect
        x={centerX - PERSON_BODY_WIDTH / 2}
        y={iconY + PERSON_HEAD_RADIUS * 2 + 4}
        width={PERSON_BODY_WIDTH}
        height={PERSON_BODY_HEIGHT}
        rx={PERSON_BODY_WIDTH / 2}
        ry={8}
        fill={colors.personFill}
        stroke={colors.personStroke}
        strokeWidth={1.5}
      />
      {/* Name label */}
      <text
        x={centerX}
        y={y + height - 18}
        textAnchor="middle"
        fill={colors.textOnBoundary}
        fontSize={NAME_FONT_SIZE}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {element.name}
      </text>
      {/* Description */}
      {element.properties.description && (
        <text
          x={centerX}
          y={y + height - 4}
          textAnchor="middle"
          fill={colors.textOnBoundary}
          fontSize={DESCRIPTION_FONT_SIZE}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.7}
        >
          {element.properties.description.length > 20
            ? element.properties.description.slice(0, 17) + '...'
            : element.properties.description}
        </text>
      )}
    </g>
  );
}

/**
 * Render an edge (relationship) with label and arrowhead.
 */
interface EdgeProps {
  edge: LayoutEdge;
  colors: typeof LIGHT_COLORS;
}

function Edge({ edge, colors }: EdgeProps): JSX.Element {
  const { points, label } = edge;

  if (points.length < 2) return <></>;

  // Shorten the edge to make room for the arrowhead
  const shortenedPoints = shortenEdgeEnd(points);

  // Build path string
  const pathD = shortenedPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Calculate arrowhead at original end point
  const arrowPoints = calculateArrowheadPoints(
    shortenedPoints[shortenedPoints.length - 1],
    points[points.length - 1]
  );

  // Get midpoint for label
  const midpoint = getEdgeMidpoint(points);

  return (
    <g>
      {/* Edge line */}
      <path
        d={pathD}
        fill="none"
        stroke={colors.edgeStroke}
        strokeWidth={1.5}
      />
      {/* Arrowhead */}
      {arrowPoints && (
        <polygon
          points={arrowPoints}
          fill={colors.edgeStroke}
        />
      )}
      {/* Label background */}
      {label && (
        <>
          <rect
            x={midpoint.x - (label.length * 3.5 + 8)}
            y={midpoint.y - 10}
            width={label.length * 7 + 16}
            height={18}
            rx={3}
            ry={3}
            fill={colors.edgeLabelBackground}
            fillOpacity={0.9}
          />
          <text
            x={midpoint.x}
            y={midpoint.y + 4}
            textAnchor="middle"
            fill={colors.edgeLabel}
            fontSize={EDGE_LABEL_FONT_SIZE}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {label}
          </text>
        </>
      )}
    </g>
  );
}

// =============================================================================
// NODE RENDERER DISPATCHER
// =============================================================================

/**
 * Render a node based on its element type.
 */
function renderNode(node: LayoutNode, colors: typeof LIGHT_COLORS): JSX.Element {
  const { element } = node;

  switch (element.type) {
    case 'system':
      return <SystemBoundary key={node.id} node={node} colors={colors} />;
    case 'container':
      return <Container key={node.id} node={node} colors={colors} />;
    case 'component':
      return <Component key={node.id} node={node} colors={colors} />;
    case 'person':
      return <Person key={node.id} node={node} colors={colors} />;
    default:
      return <Container key={node.id} node={node} colors={colors} />;
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
 * Renders a C4 architecture diagram as an SVG element.
 * Elements are layered: boundaries first, then edges, then nodes.
 */
export function C4Renderer({ layout, isDarkMode }: C4RendererProps): JSX.Element {
  const colors = getColors(isDarkMode);

  // Separate boundary nodes (systems with children) from regular nodes
  const boundaryNodes = layout.nodes.filter(
    (n) =>
      n.element.type === 'system' &&
      ((n.children?.length ?? 0) > 0 || isBoundary(n.element))
  );
  const regularNodes = layout.nodes.filter(
    (n) =>
      !(
        n.element.type === 'system' &&
        ((n.children?.length ?? 0) > 0 || isBoundary(n.element))
      )
  );

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      {/* Boundaries layer (back-most) */}
      <g className="boundaries-layer">
        {boundaryNodes.map((node) => renderNode(node, colors))}
      </g>

      {/* Edges layer */}
      <g className="edges-layer">
        {layout.edges.map((edge, i) => (
          <Edge key={`${edge.source}-${edge.target}-${i}`} edge={edge} colors={colors} />
        ))}
      </g>

      {/* Nodes layer (front-most) */}
      <g className="nodes-layer">
        {regularNodes.map((node) => renderNode(node, colors))}
      </g>
    </svg>
  );
}

// =============================================================================
// ERROR DISPLAY
// =============================================================================

export interface C4ErrorDisplayProps {
  /** Error messages to display */
  errors: { message: string; line: number; column: number }[];
  /** Whether dark mode is enabled */
  isDarkMode: boolean;
}

/**
 * Display parse errors instead of a diagram.
 */
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

/**
 * C4Component - React component for rendering and editing C4 architecture diagrams
 * Uses Shadow DOM for style isolation (like MermaidComponent)
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ESCAPE_COMMAND,
  NodeKey,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseC4 } from '../c4/parser';
import { layoutC4Diagram } from '../c4/layout';
import { $isC4Node } from './C4Node';

// =============================================================================
// C4 RENDERER COMPONENT
// =============================================================================

function C4DiagramRenderer({
  code,
  onDoubleClick,
}: {
  code: string;
  onDoubleClick: () => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Detect theme using MutationObserver
  useEffect(() => {
    const detectTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    // Create shadow root if it doesn't exist
    if (!shadowRootRef.current) {
      shadowRootRef.current = container.attachShadow({ mode: 'open' });

      // Add styles for the shadow DOM
      const style = document.createElement('style');
      style.textContent = `
        :host {
          display: block;
          width: 100%;
        }
        .c4-container {
          display: flex;
          justify-content: center;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          overflow-x: auto;
        }
        .c4-container svg {
          max-width: 100%;
          height: auto;
        }
        .c4-error {
          padding: 1rem;
          font-family: ui-monospace, monospace;
          font-size: 13px;
        }
      `;
      shadowRootRef.current.appendChild(style);
    }

    const shadowRoot = shadowRootRef.current;

    // Clear previous content (except style)
    const existingContainer = shadowRoot.querySelector('.c4-container, .c4-error');
    if (existingContainer) {
      existingContainer.remove();
    }

    // Parse and render the diagram
    const parseResult = parseC4(code);

    if (parseResult.errors.length > 0 || !parseResult.diagram) {
      // Show errors
      const errorContainer = document.createElement('div');
      errorContainer.className = 'c4-error';

      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        padding: 1rem;
        background: ${isDarkMode ? 'oklch(0.20 0.02 25)' : 'oklch(0.95 0.02 25)'};
        border-radius: 8px;
        border: 1px solid ${isDarkMode ? 'oklch(0.70 0.20 25)' : 'oklch(0.55 0.25 25)'};
      `;

      const errorTitle = document.createElement('div');
      errorTitle.style.cssText = `
        color: ${isDarkMode ? 'oklch(0.70 0.20 25)' : 'oklch(0.55 0.25 25)'};
        font-weight: 600;
        margin-bottom: 0.5rem;
      `;
      errorTitle.textContent = 'C4 Diagram Parse Error';
      errorDiv.appendChild(errorTitle);

      parseResult.errors.forEach((error) => {
        const errorLine = document.createElement('div');
        errorLine.style.color = isDarkMode ? 'oklch(0.85 0.00 0)' : 'oklch(0.25 0.00 0)';
        errorLine.textContent = `Line ${error.line}, Column ${error.column}: ${error.message}`;
        errorDiv.appendChild(errorLine);
      });

      errorContainer.appendChild(errorDiv);
      shadowRoot.appendChild(errorContainer);
      return;
    }

    // Layout and render the diagram
    const layout = layoutC4Diagram(parseResult.diagram);

    const renderContainer = document.createElement('div');
    renderContainer.className = 'c4-container';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    // Render diagram and legend — SVG dimensions set inside
    renderC4ToSVG(svg, layout, isDarkMode);

    renderContainer.appendChild(svg);
    shadowRoot.appendChild(renderContainer);
  }, [code, isDarkMode]);

  return (
    <div
      role="button"
      tabIndex={-1}
      onDoubleClick={onDoubleClick}
      ref={containerRef}
      className="c4-renderer"
      style={{
        display: 'block',
        cursor: 'pointer',
        minHeight: '100px',
      }}
    />
  );
}

// Helper function to render C4 diagram to SVG DOM
function renderC4ToSVG(
  svg: SVGSVGElement,
  layout: ReturnType<typeof layoutC4Diagram>,
  isDarkMode: boolean
): void {
  const colors = isDarkMode
    ? {
        // Dark mode: white fills, colored strokes
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
      }
    : {
        // Light mode: white fills, colored strokes, thicker borders
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

  // Render boundaries first (back layer)
  const boundariesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  boundariesGroup.setAttribute('class', 'boundaries-layer');

  // Render edges
  const edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgesGroup.setAttribute('class', 'edges-layer');

  // Render nodes
  const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesGroup.setAttribute('class', 'nodes-layer');

  // Separate boundary nodes from regular nodes
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

  // Render boundary nodes
  for (const node of boundaryNodes) {
    renderNodeToSVG(boundariesGroup, node, colors);
  }

  // Classify edge labels:
  // - Step-numbered labels (e.g. "2 [Emits event]") get a white circled number
  // - Long labels (>50 chars) get extracted to legend with circled number
  // - Short labels render inline
  const LEGEND_THRESHOLD = 50;
  const LEGEND_ROW_HEIGHT = 24;
  const LEGEND_MARGIN = 20;
  const STEP_NUMBER_PATTERN = /^(\d+)\s*\[(.+)\]$/;
  let totalWidth = layout.width;
  let totalHeight = layout.height;
  const legendEntries: { index: string; label: string; isStep: boolean }[] = [];
  let nextLetterIndex = 0;
  const nextLetter = () => String.fromCharCode(65 + (nextLetterIndex++ % 26)); // A, B, C...
  const edgesWithLabels = layout.edges.map((edge) => {
    if (!edge.label) return { ...edge, isLegendRef: false, isStepNumber: false };

    // Check for step-numbered label: "2 [description]"
    // Always add step-numbered labels to legend; also show inline if short enough
    const stepMatch = edge.label.match(STEP_NUMBER_PATTERN);
    if (stepMatch) {
      const stepNum = stepMatch[1];
      const description = stepMatch[2];
      // Always add to legend
      legendEntries.push({ index: stepNum, label: description, isStep: true });
      // Show description inline if it fits, otherwise just the circled number
      const showInline = description.length <= LEGEND_THRESHOLD;
      return {
        ...edge,
        label: stepNum,
        displayLabel: showInline ? description : undefined,
        isLegendRef: true,
        isStepNumber: true,
      };
    }

    // Non-step labels: extract long ones to legend
    if (edge.label.length > LEGEND_THRESHOLD) {
      const letter = nextLetter();
      legendEntries.push({ index: letter, label: edge.label, isStep: false });
      return { ...edge, label: letter, isLegendRef: true, isStepNumber: false };
    }
    return { ...edge, isLegendRef: false, isStepNumber: false };
  });

  // If multiple edges exist between the same pair, or any one is in the legend,
  // move ALL edges in that pair to legend (parallel labels always collide)
  const pairCounts = new Map<string, number>();
  for (const edge of edgesWithLabels) {
    if (edge.label) {
      const key = [edge.source, edge.target].sort().join('::');
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }
  const pairNeedsLegend = new Map<string, boolean>();
  for (const edge of edgesWithLabels) {
    const key = [edge.source, edge.target].sort().join('::');
    if (edge.isLegendRef || (pairCounts.get(key) ?? 0) > 1) {
      pairNeedsLegend.set(key, true);
    }
  }
  for (const edge of edgesWithLabels) {
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

  // Render edges
  for (const edge of edgesWithLabels) {
    renderEdgeToSVG(edgesGroup, edge, colors);
  }

  // Render regular nodes
  for (const node of regularNodes) {
    renderNodeToSVG(nodesGroup, node, colors);
  }

  svg.appendChild(boundariesGroup);
  svg.appendChild(nodesGroup);
  svg.appendChild(edgesGroup);

  // Render legend if there are extracted labels — smart placement
  if (legendEntries.length > 0) {
    const legendGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legendGroup.setAttribute('class', 'legend-layer');

    const circleR = 9;
    const rowHeight = LEGEND_ROW_HEIGHT;
    const longestLabel = Math.max(...legendEntries.map((e) => e.label.length), 0);
    const legendW = longestLabel * 7 + 50;
    const legendH = legendEntries.length * rowHeight + LEGEND_MARGIN;

    // Find best placement for legend within or adjacent to the diagram
    const allNodes = layout.nodes;
    const margin = LEGEND_MARGIN;

    // Check if a rectangle overlaps any node
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

    // Try a grid of candidate positions to find open space
    // Scan at intervals across the diagram area
    const step = 40;
    const candidates: { x: number; y: number }[] = [];

    // Generate candidates at grid positions, prioritizing bottom-left area
    for (let cy = layout.height - legendH - margin; cy >= margin; cy -= step) {
      for (let cx = margin; cx <= layout.width - legendW - margin; cx += step) {
        candidates.push({ x: cx, y: cy });
      }
    }
    // Also try top area
    for (let cy = margin; cy < layout.height / 2; cy += step) {
      for (let cx = margin; cx <= layout.width - legendW - margin; cx += step) {
        candidates.push({ x: cx, y: cy });
      }
    }

    let bestPlacement = { x: margin, y: layout.height + margin }; // fallback: below diagram
    let placed = false;

    for (const candidate of candidates) {
      if (candidate.x >= 0 && candidate.y >= 0 &&
          !overlapsNodes(candidate.x, candidate.y, legendW, legendH)) {
        bestPlacement = { x: candidate.x, y: candidate.y };
        placed = true;
        break;
      }
    }

    if (!placed) {
      // No space inside diagram — extend downward
      bestPlacement = { x: margin, y: layout.height + margin };
      totalHeight = bestPlacement.y + legendH + margin;
    }

    let legendX = bestPlacement.x;
    let legendY = bestPlacement.y + circleR + 4; // offset for first row

    for (const entry of legendEntries) {
      const symbolCenterX = legendX + circleR;
      const symbolCenterY = legendY - 4;

      if (entry.isStep) {
        // Step number: white-fill circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(symbolCenterX));
        circle.setAttribute('cy', String(symbolCenterY));
        circle.setAttribute('r', String(circleR));
        circle.setAttribute('fill', colors.edgeLabelBackground);
        circle.setAttribute('stroke', colors.edgeStroke);
        circle.setAttribute('stroke-width', '1.5');
        legendGroup.appendChild(circle);
      } else {
        // Legend letter: white-fill square
        const size = circleR * 2;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(symbolCenterX - size / 2));
        rect.setAttribute('y', String(symbolCenterY - size / 2));
        rect.setAttribute('width', String(size));
        rect.setAttribute('height', String(size));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', colors.edgeLabelBackground);
        rect.setAttribute('stroke', colors.edgeStroke);
        rect.setAttribute('stroke-width', '1.5');
        legendGroup.appendChild(rect);
      }

      const numText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numText.setAttribute('x', String(symbolCenterX));
      numText.setAttribute('y', String(legendY));
      numText.setAttribute('text-anchor', 'middle');
      numText.setAttribute('fill', colors.edgeStroke);
      numText.setAttribute('font-size', '10');
      numText.setAttribute('font-weight', '600');
      numText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      numText.textContent = String(entry.index);
      legendGroup.appendChild(numText);

      // Label text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(legendX + circleR * 2 + 8));
      text.setAttribute('y', String(legendY));
      text.setAttribute('fill', colors.edgeLabel);
      text.setAttribute('font-size', '11');
      text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      text.textContent = entry.label;
      legendGroup.appendChild(text);

      legendY += rowHeight;
    }

    svg.appendChild(legendGroup);
  }

  // Finalize SVG dimensions (may have been expanded for legend)
  svg.setAttribute('width', String(totalWidth));
  svg.setAttribute('height', String(totalHeight));
  svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
}

function renderNodeToSVG(
  group: SVGGElement,
  node: ReturnType<typeof layoutC4Diagram>['nodes'][0],
  colors: Record<string, string>
): void {
  const { x, y, width, height, element } = node;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  const isExt = element.properties.external === true;
  const isBoundaryStyle = element.properties.style === 'boundary';
  const hasChildren = (node.children?.length ?? 0) > 0 || isBoundaryStyle;

  if (element.type === 'person') {
    // Person icon
    const centerX = x + width / 2;
    const iconY = y + 12;
    const headRadius = 14;
    const bodyWidth = 40;
    const bodyHeight = 30;

    // Head
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    head.setAttribute('cx', String(centerX));
    head.setAttribute('cy', String(iconY + headRadius));
    head.setAttribute('r', String(headRadius));
    head.setAttribute('fill', colors.personFill);
    head.setAttribute('stroke', colors.personStroke);
    head.setAttribute('stroke-width', '1.5');
    g.appendChild(head);

    // Body
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', String(centerX - bodyWidth / 2));
    body.setAttribute('y', String(iconY + headRadius * 2 + 4));
    body.setAttribute('width', String(bodyWidth));
    body.setAttribute('height', String(bodyHeight));
    body.setAttribute('rx', String(bodyWidth / 2));
    body.setAttribute('ry', '8');
    body.setAttribute('fill', colors.personFill);
    body.setAttribute('stroke', colors.personStroke);
    body.setAttribute('stroke-width', '1.5');
    g.appendChild(body);

    // Name
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(centerX));
    text.setAttribute('y', String(y + height - 18));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', colors.textOnBoundary);
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '600');
    text.textContent = element.name;
    g.appendChild(text);
  } else if (element.properties.shape === 'cylinder') {
    // Cylinder shape for databases
    const ellipseRy = 12;
    const bodyY = y + ellipseRy;
    const bodyHeight2 = height - ellipseRy * 2;

    // Body
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', String(x));
    body.setAttribute('y', String(bodyY));
    body.setAttribute('width', String(width));
    body.setAttribute('height', String(bodyHeight2));
    body.setAttribute('fill', isExt ? colors.externalFill : colors.containerFill);
    body.setAttribute('stroke', isExt ? colors.externalStroke : colors.containerStroke);
    body.setAttribute('stroke-width', isExt ? '2.5' : '2.5');
    if (isExt) body.setAttribute('stroke-dasharray', '8 4');
    g.appendChild(body);

    // Bottom ellipse
    const bottom = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    bottom.setAttribute('cx', String(x + width / 2));
    bottom.setAttribute('cy', String(y + height - ellipseRy));
    bottom.setAttribute('rx', String(width / 2));
    bottom.setAttribute('ry', String(ellipseRy));
    bottom.setAttribute('fill', isExt ? colors.externalFill : colors.containerFill);
    bottom.setAttribute('stroke', isExt ? colors.externalStroke : colors.containerStroke);
    bottom.setAttribute('stroke-width', isExt ? '2.5' : '2.5');
    if (isExt) bottom.setAttribute('stroke-dasharray', '8 4');
    g.appendChild(bottom);

    // Top ellipse
    const top = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    top.setAttribute('cx', String(x + width / 2));
    top.setAttribute('cy', String(y + ellipseRy));
    top.setAttribute('rx', String(width / 2));
    top.setAttribute('ry', String(ellipseRy));
    top.setAttribute('fill', isExt ? colors.externalFill : colors.containerFill);
    top.setAttribute('stroke', isExt ? colors.externalStroke : colors.containerStroke);
    top.setAttribute('stroke-width', isExt ? '2.5' : '2.5');
    if (isExt) top.setAttribute('stroke-dasharray', '8 4');
    g.appendChild(top);

    // Name
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x + width / 2));
    text.setAttribute('y', String(y + height / 2 - (element.properties.tech ? 6 : 0)));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', colors.textPrimary);
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '600');
    text.textContent = element.name;
    g.appendChild(text);

    // Tech badge
    if (element.properties.tech) {
      const techText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      techText.setAttribute('x', String(x + width / 2));
      techText.setAttribute('y', String(y + height / 2 + 12));
      techText.setAttribute('text-anchor', 'middle');
      techText.setAttribute('fill', colors.textSecondary);
      techText.setAttribute('font-size', '11');
      techText.setAttribute('opacity', '0.8');
      techText.textContent = `[${element.properties.tech}]`;
      g.appendChild(techText);
    }
  } else if (element.properties.shape === 'queue') {
    // Queue/pipe shape — horizontal cylinder (database rotated 90°)
    const fill = isExt ? colors.externalFill : colors.containerFill;
    const stroke = isExt ? colors.externalStroke : colors.containerStroke;
    const ellipseRx = 16;
    const sw = '2.5';

    // Body rect (between the two ellipses)
    const bodyRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bodyRect.setAttribute('x', String(x + ellipseRx));
    bodyRect.setAttribute('y', String(y));
    bodyRect.setAttribute('width', String(width - ellipseRx * 2));
    bodyRect.setAttribute('height', String(height));
    bodyRect.setAttribute('fill', fill);
    bodyRect.setAttribute('stroke', fill); // no stroke on body — ellipses overlap
    g.appendChild(bodyRect);

    // Left ellipse
    const left = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    left.setAttribute('cx', String(x + ellipseRx));
    left.setAttribute('cy', String(y + height / 2));
    left.setAttribute('rx', String(ellipseRx));
    left.setAttribute('ry', String(height / 2));
    left.setAttribute('fill', fill);
    left.setAttribute('stroke', stroke);
    left.setAttribute('stroke-width', sw);
    if (isExt) left.setAttribute('stroke-dasharray', '8 4');
    g.appendChild(left);

    // Right ellipse (front face)
    const right = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    right.setAttribute('cx', String(x + width - ellipseRx));
    right.setAttribute('cy', String(y + height / 2));
    right.setAttribute('rx', String(ellipseRx));
    right.setAttribute('ry', String(height / 2));
    right.setAttribute('fill', fill);
    right.setAttribute('stroke', stroke);
    right.setAttribute('stroke-width', sw);
    if (isExt) right.setAttribute('stroke-dasharray', '8 4');
    g.appendChild(right);

    // Top and bottom connecting lines
    const topLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    topLine.setAttribute('x1', String(x + ellipseRx));
    topLine.setAttribute('y1', String(y));
    topLine.setAttribute('x2', String(x + width - ellipseRx));
    topLine.setAttribute('y2', String(y));
    topLine.setAttribute('stroke', stroke);
    topLine.setAttribute('stroke-width', sw);
    g.appendChild(topLine);

    const bottomLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    bottomLine.setAttribute('x1', String(x + ellipseRx));
    bottomLine.setAttribute('y1', String(y + height));
    bottomLine.setAttribute('x2', String(x + width - ellipseRx));
    bottomLine.setAttribute('y2', String(y + height));
    bottomLine.setAttribute('stroke', stroke);
    bottomLine.setAttribute('stroke-width', sw);
    g.appendChild(bottomLine);

    // Name
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x + width / 2));
    text.setAttribute('y', String(y + height / 2 - (element.properties.tech ? 6 : 0)));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', colors.textPrimary);
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '600');
    text.textContent = element.name;
    g.appendChild(text);

    // Tech badge
    if (element.properties.tech) {
      const techText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      techText.setAttribute('x', String(x + width / 2));
      techText.setAttribute('y', String(y + height / 2 + 12));
      techText.setAttribute('text-anchor', 'middle');
      techText.setAttribute('fill', colors.textSecondary);
      techText.setAttribute('font-size', '11');
      techText.setAttribute('opacity', '0.8');
      techText.textContent = `[${element.properties.tech}]`;
      g.appendChild(techText);
    }

    // Description
    if (element.properties.description) {
      const descY = y + height / 2 + (element.properties.tech ? 26 : 14);
      const descText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      descText.setAttribute('x', String(x + width / 2));
      descText.setAttribute('y', String(descY));
      descText.setAttribute('text-anchor', 'middle');
      descText.setAttribute('fill', colors.textSecondary);
      descText.setAttribute('font-size', '11');
      descText.setAttribute('opacity', '0.7');
      const desc = element.properties.description;
      descText.textContent = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;
      g.appendChild(descText);
    }
  } else {
    // Rectangle shapes (system, container, component)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', element.type === 'component' ? '4' : '8');
    rect.setAttribute('ry', element.type === 'component' ? '4' : '8');

    if (element.type === 'system') {
      rect.setAttribute('fill', isExt ? colors.externalFill : hasChildren ? colors.boundaryFill : colors.containerFill);
      rect.setAttribute('stroke', isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke);
      rect.setAttribute('stroke-width', isExt || hasChildren ? '2.5' : '2.5');
      if (isExt || hasChildren) rect.setAttribute('stroke-dasharray', '8 4');
    } else if (element.type === 'container') {
      rect.setAttribute('fill', isExt ? colors.externalFill : hasChildren ? colors.boundaryFill : colors.containerFill);
      rect.setAttribute('stroke', isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke);
      rect.setAttribute('stroke-width', isExt || hasChildren ? '2.5' : '2.5');
      if (isExt || hasChildren) rect.setAttribute('stroke-dasharray', '8 4');
    } else {
      rect.setAttribute('fill', colors.componentFill);
      rect.setAttribute('stroke', colors.componentStroke);
      rect.setAttribute('stroke-width', '1');
    }
    g.appendChild(rect);

    // Name text
    const textY = hasChildren
      ? y + 24
      : y + height / 2 - (element.properties.tech ? 6 : 0) - (element.properties.description ? 6 : 0);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x + width / 2));
    text.setAttribute('y', String(textY));
    text.setAttribute('text-anchor', 'middle');
    if (!hasChildren) {
      text.setAttribute('dominant-baseline', 'middle');
    }
    text.setAttribute('fill', hasChildren ? colors.textOnBoundary : colors.textPrimary);
    text.setAttribute('font-size', element.type === 'component' ? '13' : '14');
    text.setAttribute('font-weight', element.type === 'component' ? '500' : '600');
    text.textContent = element.name;
    g.appendChild(text);

    // Tech badge
    if (element.properties.tech) {
      const techY = hasChildren
        ? y + 40
        : y + height / 2 + 10 - (element.properties.description ? 6 : 0);

      const techText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      techText.setAttribute('x', String(x + width / 2));
      techText.setAttribute('y', String(techY));
      techText.setAttribute('text-anchor', 'middle');
      techText.setAttribute('fill', hasChildren ? colors.textOnBoundary : colors.textSecondary);
      techText.setAttribute('font-size', element.type === 'component' ? '10' : '11');
      techText.setAttribute('opacity', '0.8');
      techText.textContent = `[${element.properties.tech}]`;
      g.appendChild(techText);
    }

    // Description
    if (element.properties.description && !hasChildren) {
      const descY = y + height / 2 + (element.properties.tech ? 26 : 14);
      const descText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      descText.setAttribute('x', String(x + width / 2));
      descText.setAttribute('y', String(descY));
      descText.setAttribute('text-anchor', 'middle');
      descText.setAttribute('fill', colors.textSecondary);
      descText.setAttribute('font-size', '11');
      descText.setAttribute('opacity', '0.7');
      const desc = element.properties.description;
      descText.textContent = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;
      g.appendChild(descText);
    }
  }

  group.appendChild(g);
}

function renderEdgeToSVG(
  group: SVGGElement,
  edge: ReturnType<typeof layoutC4Diagram>['edges'][0] & {
    isLegendRef?: boolean;
    isStepNumber?: boolean;
    displayLabel?: string;
  },
  colors: Record<string, string>,
): void {
  const { points, label } = edge;
  if (points.length < 2) return;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  // Shorten edge for arrowhead
  const arrowSize = 8;
  const shortenedPoints = [...points];
  const lastIndex = shortenedPoints.length - 1;
  const secondLastIndex = lastIndex - 1;

  const dx = shortenedPoints[lastIndex].x - shortenedPoints[secondLastIndex].x;
  const dy = shortenedPoints[lastIndex].y - shortenedPoints[secondLastIndex].y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len > arrowSize) {
    const ratio = (len - arrowSize) / len;
    shortenedPoints[lastIndex] = {
      x: shortenedPoints[secondLastIndex].x + dx * ratio,
      y: shortenedPoints[secondLastIndex].y + dy * ratio,
    };
  }

  // Path
  const pathD = shortenedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', colors.edgeStroke);
  path.setAttribute('stroke-width', '1.5');
  g.appendChild(path);

  // Arrowhead
  if (len > 0) {
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tipX = points[lastIndex].x;
    const tipY = points[lastIndex].y;
    const baseX = points[lastIndex].x - ux * arrowSize;
    const baseY = points[lastIndex].y - uy * arrowSize;
    const halfW = arrowSize * 0.5;

    const arrowPoints = `${tipX},${tipY} ${baseX + px * halfW},${baseY + py * halfW} ${baseX - px * halfW},${baseY - py * halfW}`;
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrow.setAttribute('points', arrowPoints);
    arrow.setAttribute('fill', colors.edgeStroke);
    g.appendChild(arrow);
  }

  // Label
  if (label) {
    const midpoint = {
      x: (points[0].x + points[points.length - 1].x) / 2,
      y: (points[0].y + points[points.length - 1].y) / 2,
    };

    const edgeDx = points[points.length - 1].x - points[0].x;
    const edgeDy = points[points.length - 1].y - points[0].y;

    // Rotation: only for edges within 60° of horizontal
    let angleDeg = Math.atan2(edgeDy, edgeDx) * (180 / Math.PI);
    if (angleDeg > 90) angleDeg -= 180;
    if (angleDeg < -90) angleDeg += 180;
    if (Math.abs(angleDeg) > 60) angleDeg = 0;

    // Place label centered on the line (no perpendicular offset)
    const labelX = midpoint.x;
    const labelY = midpoint.y;

    const transform = `rotate(${angleDeg}, ${labelX}, ${labelY})`;

    // Step numbers render as white circles; legend letter refs as white squares
    if (edge.isStepNumber || edge.isLegendRef) {
      const isStep = edge.isStepNumber;
      const textFill = colors.edgeStroke;

      if (isStep) {
        // Step number: white-fill circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(labelX));
        circle.setAttribute('cy', String(labelY));
        circle.setAttribute('r', '10');
        circle.setAttribute('fill', colors.edgeLabelBackground);
        circle.setAttribute('stroke', colors.edgeStroke);
        circle.setAttribute('stroke-width', '1.5');
        g.appendChild(circle);
      } else {
        // Legend letter ref: white-fill square
        const size = 20;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(labelX - size / 2));
        rect.setAttribute('y', String(labelY - size / 2));
        rect.setAttribute('width', String(size));
        rect.setAttribute('height', String(size));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', colors.edgeLabelBackground);
        rect.setAttribute('stroke', colors.edgeStroke);
        rect.setAttribute('stroke-width', '1.5');
        g.appendChild(rect);
      }

      const numText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numText.setAttribute('x', String(labelX));
      numText.setAttribute('y', String(labelY + 4));
      numText.setAttribute('text-anchor', 'middle');
      numText.setAttribute('fill', textFill);
      numText.setAttribute('font-size', '10');
      numText.setAttribute('font-weight', '600');
      numText.textContent = label;
      g.appendChild(numText);

      // For step numbers with inline display label, show description above the circle
      // Circle stays centered on line, text goes above
      if (edge.isStepNumber && edge.displayLabel) {
        const descText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        descText.setAttribute('x', String(labelX));
        descText.setAttribute('y', String(labelY - 16));
        descText.setAttribute('text-anchor', 'middle');
        descText.setAttribute('fill', colors.edgeLabel);
        descText.setAttribute('font-size', '11');
        descText.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
        descText.setAttribute('transform', transform);
        descText.textContent = edge.displayLabel;
        g.appendChild(descText);
      }
    } else {
      // Split long labels into two lines at a natural break
      const LINE_BREAK_THRESHOLD = 30;
      let lines: string[];
      if (label.length > LINE_BREAK_THRESHOLD) {
        const mid = Math.floor(label.length / 2);
        // Find nearest space to the middle
        let breakIdx = label.lastIndexOf(' ', mid + 10);
        if (breakIdx < mid - 15 || breakIdx === -1) breakIdx = label.indexOf(' ', mid - 5);
        if (breakIdx === -1) breakIdx = mid;
        lines = [label.slice(0, breakIdx).trim(), label.slice(breakIdx).trim()];
      } else {
        lines = [label];
      }

      const lineHeight = 14;

      // Render text lines
      const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textEl.setAttribute('x', String(labelX));
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('fill', colors.edgeLabel);
      textEl.setAttribute('font-size', '11');
      textEl.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      textEl.setAttribute('transform', transform);

      // Single line: position above the line; multi-line: straddle
      const startY = lines.length === 1
        ? labelY - 6  // above the line
        : labelY - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', String(labelX));
        tspan.setAttribute('y', String(startY + i * lineHeight));
        tspan.textContent = lines[i];
        textEl.appendChild(tspan);
      }

      g.appendChild(textEl);
    }
  }

  group.appendChild(g);
}

// =============================================================================
// C4 EDITOR COMPONENT
// =============================================================================

function C4Editor({
  code,
  setCode,
  onClose,
}: {
  code: string;
  setCode: (code: string) => void;
  onClose: () => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="c4-editor-container">
      <div className="c4-editor-header">
        <span className="c4-editor-label">```c4</span>
        <button
          className="c4-editor-close"
          onClick={onClose}
          title="Close editor (Esc)"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="c4-editor-textarea"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter C4 diagram code..."
        spellCheck={false}
      />
      <div className="c4-editor-footer">
        <span className="c4-editor-label">```</span>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN C4 COMPONENT
// =============================================================================

interface C4ComponentProps {
  code: string;
  nodeKey: NodeKey;
}

export default function C4Component({
  code,
  nodeKey,
}: C4ComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const [codeValue, setCodeValue] = useState(code);
  const [showEditor, setShowEditor] = useState<boolean>(false);

  // Listen for editable changes
  useEffect(() => {
    return editor.registerEditableListener((editable) => {
      setIsEditable(editable);
    });
  }, [editor]);

  const onHide = useCallback(() => {
    setShowEditor(false);
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isC4Node(node)) {
        node.setCode(codeValue);
      }
    });
  }, [editor, codeValue, nodeKey]);

  useEffect(() => {
    if (!showEditor && codeValue !== code) {
      setCodeValue(code);
    }
  }, [showEditor, code, codeValue]);

  useEffect(() => {
    if (!isEditable) {
      return;
    }
    if (showEditor) {
      return mergeRegister(
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            // Don't close on selection change while editing
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (showEditor) {
              onHide();
              return true;
            }
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      );
    } else {
      return editor.registerUpdateListener(({ editorState }) => {
        const isSelected = editorState.read(() => {
          const selection = $getSelection();
          return (
            $isNodeSelection(selection) &&
            selection.has(nodeKey) &&
            selection.getNodes().length === 1
          );
        });
        if (isSelected) {
          setShowEditor(true);
        }
      });
    }
  }, [editor, nodeKey, onHide, showEditor, isEditable]);

  if (showEditor && isEditable) {
    return (
      <C4Editor
        code={codeValue}
        setCode={setCodeValue}
        onClose={onHide}
      />
    );
  }

  return (
    <C4DiagramRenderer
      code={codeValue}
      onDoubleClick={() => {
        if (isEditable) {
          setShowEditor(true);
        }
      }}
    />
  );
}

/**
 * Server-side C4 SVG Renderer
 *
 * Renders C4 diagrams to SVG strings without DOM dependencies.
 * Mirrors the imperative renderer in C4Component.tsx (the authoritative renderer),
 * producing identical output using string concatenation instead of DOM APIs.
 *
 * Used by the app_render_c4_diagram MCP tool to generate SVGs for publishing.
 */

import type { LayoutResult, LayoutNode, LayoutEdge, Point } from './types';
import { buildClippedEdgePaths } from './edge-clipping';

// =============================================================================
// COLOR PALETTES (matching C4Component.tsx imperative renderer)
// =============================================================================

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

function getColors(isDarkMode: boolean): Colors {
  return isDarkMode ? DARK_COLORS : LIGHT_COLORS;
}

// =============================================================================
// XML ESCAPING
// =============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// =============================================================================
// NODE RENDERING
// =============================================================================

function renderNodeToString(
  node: LayoutNode,
  colors: Colors,
  allNodes: LayoutNode[],
): string {
  const { x, y, width, height, element } = node;
  const isExt = element.properties.external === true;
  const isBoundaryStyle = element.properties.style === 'boundary';
  const hasChildren = (node.children?.length ?? 0) > 0 || isBoundaryStyle;

  // Compute nesting depth for alternating boundary fills
  let depth = 0;
  let parentId = element.parent;
  while (parentId) {
    depth++;
    const parentNode = allNodes.find((n) => n.id === parentId);
    parentId = parentNode?.element.parent;
  }
  const boundaryFillColor = depth % 2 === 0 ? colors.boundaryFill : colors.containerFill;

  if (element.type === 'person') {
    return renderPerson(x, y, width, height, element, colors);
  }

  if (element.properties.shape === 'cylinder') {
    return renderCylinder(x, y, width, height, element, isExt, colors);
  }

  if (element.properties.shape === 'queue') {
    return renderQueue(x, y, width, height, element, isExt, colors);
  }

  return renderRectNode(x, y, width, height, element, isExt, hasChildren, boundaryFillColor, colors);
}

function renderPerson(
  x: number, y: number, width: number, height: number,
  element: LayoutNode['element'], colors: Colors,
): string {
  const centerX = x + width / 2;
  const iconY = y + 12;
  const headRadius = 14;
  const bodyWidth = 40;
  const bodyHeight = 30;

  let svg = '<g>';
  svg += `<circle cx="${centerX}" cy="${iconY + headRadius}" r="${headRadius}" fill="${colors.personFill}" stroke="${colors.personStroke}" stroke-width="1.5"/>`;
  svg += `<rect x="${centerX - bodyWidth / 2}" y="${iconY + headRadius * 2 + 4}" width="${bodyWidth}" height="${bodyHeight}" rx="${bodyWidth / 2}" ry="8" fill="${colors.personFill}" stroke="${colors.personStroke}" stroke-width="1.5"/>`;
  svg += `<text x="${centerX}" y="${y + height - 18}" text-anchor="middle" fill="${colors.textOnBoundary}" font-size="14" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(element.name)}</text>`;
  svg += '</g>';
  return svg;
}

function renderCylinder(
  x: number, y: number, width: number, height: number,
  element: LayoutNode['element'], isExt: boolean, colors: Colors,
): string {
  const ellipseRy = 12;
  const bodyY = y + ellipseRy;
  const bodyHeight = height - ellipseRy * 2;
  const fill = isExt ? colors.externalFill : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : colors.containerStroke;
  const dash = isExt ? ' stroke-dasharray="8 4"' : '';

  let svg = '<g>';
  svg += `<rect x="${x}" y="${bodyY}" width="${width}" height="${bodyHeight}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`;
  svg += `<ellipse cx="${x + width / 2}" cy="${y + height - ellipseRy}" rx="${width / 2}" ry="${ellipseRy}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`;
  svg += `<ellipse cx="${x + width / 2}" cy="${y + ellipseRy}" rx="${width / 2}" ry="${ellipseRy}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`;
  svg += `<text x="${x + width / 2}" y="${y + height / 2 - (element.properties.tech ? 6 : 0)}" text-anchor="middle" dominant-baseline="middle" fill="${colors.textPrimary}" font-size="14" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(element.name)}</text>`;
  if (element.properties.tech) {
    svg += `<text x="${x + width / 2}" y="${y + height / 2 + 12}" text-anchor="middle" fill="${colors.textSecondary}" font-size="11" font-family="system-ui, -apple-system, sans-serif" opacity="0.8">[${escapeXml(element.properties.tech)}]</text>`;
  }
  svg += '</g>';
  return svg;
}

function renderQueue(
  x: number, y: number, width: number, height: number,
  element: LayoutNode['element'], isExt: boolean, colors: Colors,
): string {
  const fill = isExt ? colors.externalFill : colors.containerFill;
  const stroke = isExt ? colors.externalStroke : colors.containerStroke;
  const ellipseRx = 16;
  const sw = '2.5';
  const dash = isExt ? ' stroke-dasharray="8 4"' : '';

  let svg = '<g>';
  // Body rect
  svg += `<rect x="${x + ellipseRx}" y="${y}" width="${width - ellipseRx * 2}" height="${height}" fill="${fill}" stroke="${fill}"/>`;
  // Left ellipse
  svg += `<ellipse cx="${x + ellipseRx}" cy="${y + height / 2}" rx="${ellipseRx}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  // Right ellipse
  svg += `<ellipse cx="${x + width - ellipseRx}" cy="${y + height / 2}" rx="${ellipseRx}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  // Top/bottom lines
  svg += `<line x1="${x + ellipseRx}" y1="${y}" x2="${x + width - ellipseRx}" y2="${y}" stroke="${stroke}" stroke-width="${sw}"/>`;
  svg += `<line x1="${x + ellipseRx}" y1="${y + height}" x2="${x + width - ellipseRx}" y2="${y + height}" stroke="${stroke}" stroke-width="${sw}"/>`;
  // Name
  svg += `<text x="${x + width / 2}" y="${y + height / 2 - (element.properties.tech ? 6 : 0)}" text-anchor="middle" dominant-baseline="middle" fill="${colors.textPrimary}" font-size="14" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(element.name)}</text>`;
  if (element.properties.tech) {
    svg += `<text x="${x + width / 2}" y="${y + height / 2 + 12}" text-anchor="middle" fill="${colors.textSecondary}" font-size="11" font-family="system-ui, -apple-system, sans-serif" opacity="0.8">[${escapeXml(element.properties.tech)}]</text>`;
  }
  if (element.properties.description) {
    const desc = element.properties.description;
    const truncated = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;
    svg += `<text x="${x + width / 2}" y="${y + height / 2 + (element.properties.tech ? 26 : 14)}" text-anchor="middle" fill="${colors.textSecondary}" font-size="11" font-family="system-ui, -apple-system, sans-serif" opacity="0.7">${escapeXml(truncated)}</text>`;
  }
  svg += '</g>';
  return svg;
}

function renderRectNode(
  x: number, y: number, width: number, height: number,
  element: LayoutNode['element'], isExt: boolean, hasChildren: boolean,
  boundaryFillColor: string, colors: Colors,
): string {
  const rx = element.type === 'component' ? '4' : '8';
  let fill: string, stroke: string, strokeWidth: string, dash: string;

  if (element.type === 'system') {
    fill = isExt ? colors.externalFill : hasChildren ? boundaryFillColor : colors.containerFill;
    stroke = isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke;
    strokeWidth = '2.5';
    dash = (isExt || hasChildren) ? ' stroke-dasharray="8 4"' : '';
  } else if (element.type === 'container') {
    fill = isExt ? colors.externalFill : hasChildren ? boundaryFillColor : colors.containerFill;
    stroke = isExt ? colors.externalStroke : hasChildren ? colors.boundaryStroke : colors.containerStroke;
    strokeWidth = '2.5';
    dash = (isExt || hasChildren) ? ' stroke-dasharray="8 4"' : '';
  } else {
    fill = colors.componentFill;
    stroke = colors.componentStroke;
    strokeWidth = '2.5';
    dash = '';
  }

  const textColor = hasChildren ? colors.textOnBoundary : colors.textPrimary;
  const textY = hasChildren
    ? y + 24
    : y + height / 2 - (element.properties.tech ? 6 : 0) - (element.properties.description ? 6 : 0);
  const fontSize = element.type === 'component' ? '13' : '14';
  const fontWeight = element.type === 'component' ? '500' : '600';

  let svg = '<g>';
  svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  svg += `<text x="${x + width / 2}" y="${textY}" text-anchor="middle"${hasChildren ? '' : ' dominant-baseline="middle"'} fill="${textColor}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="system-ui, -apple-system, sans-serif">${escapeXml(element.name)}</text>`;

  if (element.properties.tech) {
    const techY = hasChildren
      ? y + 40
      : y + height / 2 + 10 - (element.properties.description ? 6 : 0);
    const techFontSize = element.type === 'component' ? '10' : '11';
    svg += `<text x="${x + width / 2}" y="${techY}" text-anchor="middle" fill="${hasChildren ? colors.textOnBoundary : colors.textSecondary}" font-size="${techFontSize}" font-family="system-ui, -apple-system, sans-serif" opacity="0.8">[${escapeXml(element.properties.tech)}]</text>`;
  }

  if (element.properties.description && !hasChildren) {
    const descY = y + height / 2 + (element.properties.tech ? 26 : 14);
    const desc = element.properties.description;
    const truncated = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;
    svg += `<text x="${x + width / 2}" y="${descY}" text-anchor="middle" fill="${colors.textSecondary}" font-size="11" font-family="system-ui, -apple-system, sans-serif" opacity="0.7">${escapeXml(truncated)}</text>`;
  }

  svg += '</g>';
  return svg;
}

// =============================================================================
// EDGE RENDERING (with legend support matching C4Component.tsx)
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

function processEdgesForLegend(edges: LayoutEdge[]): { edges: ProcessedEdge[]; legendEntries: LegendEntry[] } {
  const LEGEND_THRESHOLD = 50;
  const STEP_NUMBER_PATTERN = /^(\d+)\s*\[(.+)\]$/;
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

  // If multiple edges between same pair, move ALL to legend
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

function renderEdgeToString(edge: ProcessedEdge, colors: Colors): string {
  const { points, label } = edge;
  if (points.length < 2) return '';

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

  // Compute label clipping info
  let labelClipInfo: { center: Point; halfW: number; halfH: number; angleDeg: number } | null = null;
  if (label) {
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

    if (edge.isStepNumber || edge.isLegendRef) {
      // Step numbers use circle r=10, legend refs use square 20x20 — clip around shape
      const shapeR = 10;
      const pad = 2;
      labelClipInfo = { center: { x: midpoint.x, y: midpoint.y }, halfW: shapeR + pad, halfH: shapeR + pad, angleDeg: 0 };
    } else {
      const lines = splitEdgeLabel(label);
      const longestLine = lines.reduce((a, b) => (a.length > b.length ? a : b), '');
      const edgeLabelFontSize = 11;
      const avgCharWidth = edgeLabelFontSize * 0.55;
      const halfW = (longestLine.length * avgCharWidth) / 2 + 3;
      const lineHeight = 14;

      const ascent = edgeLabelFontSize * 0.8;
      const descent = edgeLabelFontSize * 0.2;
      const pad = 3;

      let clipTop: number;
      let clipBottom: number;
      if (lines.length === 1) {
        const baseline = midpoint.y + 4;
        clipTop = baseline - ascent - pad;
        clipBottom = baseline + descent + pad;
      } else {
        const firstBaseline = midpoint.y - ((lines.length - 1) * lineHeight) / 2;
        const lastBaseline = firstBaseline + (lines.length - 1) * lineHeight;
        clipTop = firstBaseline - ascent - pad;
        clipBottom = lastBaseline + descent + pad;
      }

      const clipCenterY = (clipTop + clipBottom) / 2;
      const halfH = (clipBottom - clipTop) / 2;

      labelClipInfo = { center: { x: midpoint.x, y: clipCenterY }, halfW, halfH, angleDeg };
    }
  }

  // Build edge path(s) — clip around label if present
  const pathDataStrings: string[] = [];
  if (labelClipInfo) {
    pathDataStrings.push(...buildClippedEdgePaths(
      shortenedPoints,
      labelClipInfo.center,
      labelClipInfo.halfW,
      labelClipInfo.halfH,
      labelClipInfo.angleDeg,
    ));
  } else {
    pathDataStrings.push(
      shortenedPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    );
  }

  let svg = '<g>';
  for (const pathD of pathDataStrings) {
    svg += `<path d="${pathD}" fill="none" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;
  }

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
    svg += `<polygon points="${tipX},${tipY} ${baseX + px * halfW},${baseY + py * halfW} ${baseX - px * halfW},${baseY - py * halfW}" fill="${colors.edgeStroke}"/>`;
  }

  // Label
  if (label) {
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
    const transform = `rotate(${angleDeg}, ${labelX}, ${labelY})`;

    if (edge.isStepNumber || edge.isLegendRef) {
      if (edge.isStepNumber) {
        svg += `<circle cx="${labelX}" cy="${labelY}" r="10" fill="${colors.edgeLabelBackground}" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;
      } else {
        svg += `<rect x="${labelX - 10}" y="${labelY - 10}" width="20" height="20" rx="3" fill="${colors.edgeLabelBackground}" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;
      }
      svg += `<text x="${labelX}" y="${labelY + 4}" text-anchor="middle" fill="${colors.edgeStroke}" font-size="10" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(label)}</text>`;

      if (edge.isStepNumber && edge.displayLabel) {
        svg += `<text x="${labelX}" y="${labelY - 16}" text-anchor="middle" fill="${colors.edgeLabel}" font-size="11" font-family="system-ui, -apple-system, sans-serif" transform="${transform}">${escapeXml(edge.displayLabel)}</text>`;
      }
    } else {
      const lines = splitEdgeLabel(label);
      const lineHeight = 14;

      // Center text on the line — the line is clipped around the label
      const startY = lines.length === 1
        ? labelY + 4  // baseline offset to visually center 11px text
        : labelY - ((lines.length - 1) * lineHeight) / 2;

      svg += `<text x="${labelX}" text-anchor="middle" fill="${colors.edgeLabel}" font-size="11" font-family="system-ui, -apple-system, sans-serif" transform="${transform}">`;
      for (let i = 0; i < lines.length; i++) {
        svg += `<tspan x="${labelX}" y="${startY + i * lineHeight}">${escapeXml(lines[i])}</tspan>`;
      }
      svg += '</text>';
    }
  }

  svg += '</g>';
  return svg;
}

// =============================================================================
// LEGEND RENDERING
// =============================================================================

function renderLegend(
  legendEntries: LegendEntry[],
  layout: LayoutResult,
  colors: Colors,
): { svg: string; totalWidth: number; totalHeight: number } {
  const LEGEND_ROW_HEIGHT = 24;
  const LEGEND_MARGIN = 20;
  const circleR = 9;

  let totalWidth = layout.width;
  let totalHeight = layout.height;

  const longestLabel = Math.max(...legendEntries.map((e) => e.label.length), 0);
  const legendW = Math.min(longestLabel * 6 + 40, 400);
  const legendH = legendEntries.length * LEGEND_ROW_HEIGHT + LEGEND_MARGIN;

  // Smart legend placement - find non-overlapping position
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

  // Also try positions right of each node
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

  if (bestPlacement.x + legendW + margin > totalWidth) {
    totalWidth = bestPlacement.x + legendW + margin;
  }
  if (bestPlacement.y + legendH + margin > totalHeight) {
    totalHeight = bestPlacement.y + legendH + margin;
  }

  const legendX = bestPlacement.x;
  let legendY = bestPlacement.y + circleR + 4;

  let svg = '<g class="legend-layer">';
  for (const entry of legendEntries) {
    const symbolCenterX = legendX + circleR;
    const symbolCenterY = legendY - 4;

    if (entry.isStep) {
      svg += `<circle cx="${symbolCenterX}" cy="${symbolCenterY}" r="${circleR}" fill="${colors.edgeLabelBackground}" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;
    } else {
      const size = circleR * 2;
      svg += `<rect x="${symbolCenterX - size / 2}" y="${symbolCenterY - size / 2}" width="${size}" height="${size}" rx="3" fill="${colors.edgeLabelBackground}" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;
    }

    svg += `<text x="${symbolCenterX}" y="${legendY}" text-anchor="middle" fill="${colors.edgeStroke}" font-size="10" font-weight="600" font-family="system-ui, -apple-system, sans-serif">${escapeXml(String(entry.index))}</text>`;
    svg += `<text x="${legendX + circleR * 2 + 8}" y="${legendY}" fill="${colors.edgeLabel}" font-size="11" font-family="system-ui, -apple-system, sans-serif">${escapeXml(entry.label)}</text>`;

    legendY += LEGEND_ROW_HEIGHT;
  }
  svg += '</g>';

  return { svg, totalWidth, totalHeight };
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Render a C4 layout result to an SVG string.
 *
 * Mirrors the imperative renderC4ToSVG() in C4Component.tsx, producing
 * identical output as a string for server-side use.
 */
export function renderC4ToSVGString(layout: LayoutResult, isDarkMode: boolean): string {
  const colors = getColors(isDarkMode);

  // Separate boundary and regular nodes
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

  // Process edges and extract legend entries
  const { edges: processedEdges, legendEntries } = processEdgesForLegend(layout.edges);

  // Build SVG layers
  let boundariesSvg = '<g class="boundaries-layer">';
  for (const node of boundaryNodes) {
    boundariesSvg += renderNodeToString(node, colors, layout.nodes);
  }
  boundariesSvg += '</g>';

  let nodesSvg = '<g class="nodes-layer">';
  for (const node of regularNodes) {
    nodesSvg += renderNodeToString(node, colors, layout.nodes);
  }
  nodesSvg += '</g>';

  let edgesSvg = '<g class="edges-layer">';
  for (const edge of processedEdges) {
    edgesSvg += renderEdgeToString(edge, colors);
  }
  edgesSvg += '</g>';

  // Compute final dimensions (may expand for legend)
  let totalWidth = layout.width;
  let totalHeight = layout.height;
  let legendSvg = '';

  if (legendEntries.length > 0) {
    const legend = renderLegend(legendEntries, layout, colors);
    legendSvg = legend.svg;
    totalWidth = legend.totalWidth;
    totalHeight = legend.totalHeight;
  }

  return `<svg width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="font-family: system-ui, -apple-system, sans-serif">${boundariesSvg}${nodesSvg}${edgesSvg}${legendSvg}</svg>`;
}

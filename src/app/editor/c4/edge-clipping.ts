/**
 * Edge line clipping utilities for C4 diagrams.
 *
 * Computes where edge polylines intersect label bounding boxes and splits
 * them into visible segments, creating clean gaps around label text.
 */

import type { Point } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Average character width as a ratio of font size (for monospace-ish system fonts) */
const AVG_CHAR_WIDTH_RATIO = 0.62;

/** Horizontal padding around label text for the clipping box */
const LABEL_PADDING_X = 6;

/** Vertical padding around label text for the clipping box */
const LABEL_PADDING_Y = 4;

// =============================================================================
// LABEL SIZE ESTIMATION
// =============================================================================

/**
 * Estimate the half-width and half-height of a label's bounding box.
 */
export function estimateLabelSize(
  label: string,
  fontSize: number
): { halfW: number; halfH: number } {
  const avgCharWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
  const halfW = (label.length * avgCharWidth) / 2 + LABEL_PADDING_X;
  const halfH = fontSize / 2 + LABEL_PADDING_Y;
  return { halfW, halfH };
}

// =============================================================================
// POLYLINE CLIPPING
// =============================================================================

/**
 * Build clipped edge path strings that leave a gap where the label sits.
 *
 * Transforms points into the label's local coordinate system (accounting for
 * rotation), finds where line segments cross the label bounding box, and
 * splits the polyline into visible portions outside the box.
 *
 * @returns SVG path data strings for each visible segment
 */
export function buildClippedEdgePaths(
  points: Point[],
  labelCenter: Point,
  labelHalfW: number,
  labelHalfH: number,
  angleDeg: number
): string[] {
  const angleRad = (-angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const toLocal = (p: Point): Point => ({
    x: (p.x - labelCenter.x) * cosA - (p.y - labelCenter.y) * sinA,
    y: (p.x - labelCenter.x) * sinA + (p.y - labelCenter.y) * cosA,
  });

  const isInBox = (p: Point): boolean => {
    const l = toLocal(p);
    return Math.abs(l.x) < labelHalfW && Math.abs(l.y) < labelHalfH;
  };

  const findCrossings = (p1: Point, p2: Point): number[] => {
    const l1 = toLocal(p1);
    const l2 = toLocal(p2);
    const dx = l2.x - l1.x;
    const dy = l2.y - l1.y;
    const ts: number[] = [];

    for (const bx of [-labelHalfW, labelHalfW]) {
      if (dx !== 0) {
        const t = (bx - l1.x) / dx;
        if (t > 0 && t < 1) {
          const y = l1.y + t * dy;
          if (Math.abs(y) <= labelHalfH) ts.push(t);
        }
      }
    }
    for (const by of [-labelHalfH, labelHalfH]) {
      if (dy !== 0) {
        const t = (by - l1.y) / dy;
        if (t > 0 && t < 1) {
          const x = l1.x + t * dx;
          if (Math.abs(x) <= labelHalfW) ts.push(t);
        }
      }
    }

    return ts.sort((a, b) => a - b);
  };

  const lerp = (p1: Point, p2: Point, t: number): Point => ({
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  });

  const visibleSegments: Point[][] = [];
  let current: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const inside = isInBox(p);

    if (i === 0) {
      if (!inside) current.push(p);
      continue;
    }

    const prev = points[i - 1];
    const prevInside = isInBox(prev);
    const crossings = findCrossings(prev, p);

    if (!prevInside && !inside && crossings.length === 0) {
      current.push(p);
    } else if (!prevInside && !inside && crossings.length === 1) {
      // Tangent touch — treat as no clipping
      current.push(p);
    } else if (!prevInside && !inside && crossings.length >= 2) {
      current.push(lerp(prev, p, crossings[0]));
      visibleSegments.push(current);
      current = [lerp(prev, p, crossings[crossings.length - 1]), p];
    } else if (!prevInside && inside) {
      if (crossings.length > 0) {
        current.push(lerp(prev, p, crossings[0]));
      }
      if (current.length >= 2) visibleSegments.push(current);
      current = [];
    } else if (prevInside && !inside) {
      if (crossings.length > 0) {
        current = [lerp(prev, p, crossings[crossings.length - 1])];
      }
      current.push(p);
    }
    // both inside — skip
  }

  if (current.length >= 2) {
    visibleSegments.push(current);
  }

  const paths = visibleSegments
    .filter((seg) => seg.length >= 2)
    .map((seg) =>
      seg.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    );

  // Fallback: if clipping consumed the entire edge, draw the original path
  // rather than leaving a floating arrowhead with no line
  if (paths.length === 0 && points.length >= 2) {
    return [
      points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '),
    ];
  }

  return paths;
}

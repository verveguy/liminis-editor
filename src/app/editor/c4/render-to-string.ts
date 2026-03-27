/**
 * Headless C4 SVG rendering — pure .ts wrapper (no JSX).
 *
 * Bridges the React C4Renderer to Node.js contexts (Electron main process)
 * by using renderToStaticMarkup + createElement instead of JSX.
 *
 * Used by the app_render_c4_diagram MCP tool for Confluence publishing.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { C4Renderer } from './renderer';
import { parseC4, validateC4 } from './parser';
import { layoutC4Diagram } from './layout';
import type { ParseError } from './types';

/**
 * Parse C4 code and render to SVG string in one call.
 *
 * @param code - C4 DSL source code
 * @param isDarkMode - Whether to render in dark mode
 * @param manualPositions - Optional manual positions for elements (bypasses dagre auto-layout)
 * @returns svg string and any parse/validation errors
 */
export function renderC4DiagramToSVG(
  code: string,
  isDarkMode: boolean = false,
  manualPositions?: Record<string, { x: number; y: number }>,
): { svg: string; errors: ParseError[] } {
  const parseResult = parseC4(code);

  if (parseResult.diagram) {
    const validationErrors = validateC4(parseResult.diagram);
    parseResult.errors.push(...validationErrors);
  }

  if (!parseResult.diagram || parseResult.errors.length > 0) {
    return { svg: '', errors: parseResult.errors };
  }

  const layout = layoutC4Diagram(parseResult.diagram, undefined, manualPositions);
  const svg = renderToStaticMarkup(
    createElement(C4Renderer, { layout, isDarkMode })
  );

  return { svg, errors: [] };
}

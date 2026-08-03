/**
 * Shared diagram utilities for SVG extraction and manipulation.
 * Used by both the clipboard copy path (diagram-context-menu.ts)
 * and the PDF export path (EditorColumn.tsx).
 */

/**
 * Find the SVG element within a diagram container.
 * Checks both direct light-DOM descendants and shadow DOM.
 *
 * For C4 diagrams: the SVG is in the light DOM, tagged with [data-diagram].
 * For Mermaid diagrams: the SVG is inside a shadow root.
 */
export function findSvgElement(container: HTMLElement): SVGSVGElement | null {
  // Descendant SVG (React renderer — C4)
  // Prefer svg[data-diagram] to skip toolbar icon SVGs (Lucide),
  // then fall back to any descendant svg
  const directSvg = container.querySelector<SVGSVGElement>('svg[data-diagram]')
    ?? container.querySelector('svg');
  if (directSvg) return directSvg;

  // Shadow DOM SVG (Mermaid renderer)
  const shadowRoot = container.shadowRoot;
  if (shadowRoot) {
    const shadowSvg = shadowRoot.querySelector('svg');
    if (shadowSvg) return shadowSvg;
  }

  return null;
}

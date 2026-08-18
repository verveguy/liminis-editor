/**
 * Shared DOM helpers for locating an editor's scroll container and scrolling
 * an element into view within it. `AnchorScrollPlugin` (anchor-link
 * navigation) and `OutlinePlugin` (table-of-contents navigation) both need to
 * find "the nearest thing that actually scrolls" without the host declaring
 * one explicitly (FR-006) — this is the one place that logic lives.
 */

/**
 * Find the scrollable container for an element: the known editor scroll ids
 * first, then the nearest ancestor that actually scrolls (robust to host
 * markup).
 */
export function scrollContainerFor(element: HTMLElement): HTMLElement | null {
  // Assumes the two known ids are never nested inside one another; neither
  // known host does. If that ever changes, the closer one should win instead.
  const byId =
    element.closest('#editor-scroll-container') ||
    element.closest('#editor-panel-scroll-container');
  if (byId) return byId as HTMLElement;
  let el: HTMLElement | null = element.parentElement;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (/(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Scroll `target` into view within its scroll container (or the viewport, if
 * none is found), positioning it near the top rather than flush against it.
 */
export function scrollElementIntoView(target: HTMLElement, margin = 16): void {
  const container = scrollContainerFor(target);
  if (container) {
    // rect-based offset is robust regardless of the target's offsetParent;
    // leave a small margin so it sits near the top, not flush against it.
    const top = Math.max(
      0,
      target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        margin
    );
    container.scrollTo({ top, behavior: 'smooth' });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

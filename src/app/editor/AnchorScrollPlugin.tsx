import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { LexicalEditor } from 'lexical';
import { useEditorHost } from '../../host/context';

/**
 * Reduce text to a GitHub-style anchor slug so a link fragment matches a heading
 * regardless of punctuation the anchor drops. GitHub lowercases, removes
 * punctuation (dots, backticks, `?`, emoji, …), and turns spaces into hyphens —
 * e.g. a heading "Rebase and migration from `.env.enc`" slugs to
 * `rebase-and-migration-from-envenc`, matching that link fragment. Applying the
 * same reduction to both the anchor and each heading makes them comparable.
 * `\p{L}\p{N}` (rather than `a-z0-9`) keeps non-Latin letters — e.g. "Übersicht"
 * or "介绍" — instead of stripping them to nothing, which would make such
 * headings permanently unreachable and collide with unrelated ASCII headings.
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '') // drop punctuation/emoji GitHub strips
    .trim()
    .replace(/[\s-]+/g, '-') // spaces and dash runs → single hyphen
    .replace(/^-+|-+$/g, ''); // trim stray hyphens
}

/**
 * Find the scrollable container for a heading: the known editor scroll ids first,
 * then the nearest ancestor that actually scrolls (robust to host markup).
 */
function scrollContainerFor(heading: HTMLElement): HTMLElement | null {
  // Assumes the two known ids are never nested inside one another; neither
  // known host does. If that ever changes, the closer one should win instead.
  const byId =
    heading.closest('#editor-scroll-container') ||
    heading.closest('#editor-panel-scroll-container');
  if (byId) return byId as HTMLElement;
  let el: HTMLElement | null = heading.parentElement;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (/(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Scroll the editor to the heading whose normalized text matches `anchor`.
 * Returns true if a matching heading was found and scrolled — false if not (yet)
 * present, so the caller can retry while async content finishes rendering.
 */
function scrollToHeading(editor: LexicalEditor, anchor: string): boolean {
  const normalizedAnchor = normalizeForMatch(anchor);
  if (!normalizedAnchor) return false;
  const rootElement = editor.getRootElement();
  if (!rootElement) return false;

  const selector = [
    '.editor-heading-h1',
    '.editor-heading-h2',
    '.editor-heading-h3',
    '.editor-heading-h4',
    '.editor-heading-h5',
  ].join(',');
  const headings = Array.from(rootElement.querySelectorAll<HTMLElement>(selector));
  const heading = headings.find(
    (h) => normalizeForMatch(h.textContent || '') === normalizedAnchor
  );
  if (!heading) return false;

  const container = scrollContainerFor(heading);
  if (container) {
    // rect-based offset is robust regardless of the heading's offsetParent;
    // leave a small margin so the heading sits near the top, not flush against it.
    const MARGIN = 16;
    const top = Math.max(
      0,
      heading.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        MARGIN
    );
    container.scrollTo({ top, behavior: 'smooth' });
  } else {
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return true;
}

/**
 * AnchorScrollPlugin - Scrolls to headings when anchor links are clicked
 *
 * This plugin listens for host "scroll to anchor" requests (raised when an anchor
 * link like `[[#Heading Name]]` is clicked) and scrolls to the matching heading in
 * the document.
 *
 * The plugin:
 * 1. Subscribes via the injected `onScrollToAnchor` host service
 * 2. Finds headings by GitHub-style slug matching (case-insensitive, punctuation-stripped)
 * 3. Retries across animation frames (bounded) while async content (equations,
 *    diagrams, code highlighting) is still rendering the target heading
 * 4. Scrolls the discovered scrollable ancestor, positioning the heading near the top
 * 5. Cleans up the subscription and any in-flight retry loop on unmount
 */
export function AnchorScrollPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const { onScrollToAnchor } = useEditorHost();

  useEffect(() => {
    // Early exit if the host does not offer anchor scrolling
    if (!onScrollToAnchor) {
      return;
    }

    let raf = 0;

    const unsubscribe = onScrollToAnchor((anchor: string) => {
      // A new anchor emission supersedes any retry loop still in flight for a
      // previous one.
      cancelAnimationFrame(raf);

      // Normalization is independent of DOM timing, so an anchor that
      // normalizes to empty (e.g. punctuation-only) can never match no
      // matter how long we retry — skip the animation-frame budget entirely.
      if (!normalizeForMatch(anchor)) return;

      let attempts = 0;
      const tryScroll = () => {
        if (scrollToHeading(editor, anchor)) return;
        if (attempts++ < 30) raf = requestAnimationFrame(tryScroll);
      };
      tryScroll();
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [editor, onScrollToAnchor]);

  return null;
}

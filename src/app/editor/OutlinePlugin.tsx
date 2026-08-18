import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { OutlineHandleImpl, type DocumentOutlineHandle, type OutlineEntry } from './documentOutline';
import { scrollContainerFor, scrollElementIntoView } from './scrollContainer';

const HEADING_SELECTOR = [
  '.editor-heading-h1',
  '.editor-heading-h2',
  '.editor-heading-h3',
  '.editor-heading-h4',
  '.editor-heading-h5',
].join(',');

function readHeadingEntries(): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let index = 0;
  for (const child of $getRoot().getChildren()) {
    if (!$isHeadingNode(child)) continue;
    // H6 has no theme class (`Editor.tsx`'s `editorTheme.heading` maps only
    // h1-h5), so it never appears in `HEADING_SELECTOR` either — excluding it
    // here keeps `entries` and the rendered heading DOM in the same order.
    const level = Number(child.getTag().slice(1));
    if (level < 1 || level > 5) continue;
    entries.push({ index: index++, level: level as OutlineEntry['level'], text: child.getTextContent() });
  }
  return entries;
}

/**
 * OutlinePlugin - Feeds a `DocumentOutlineHandle` from inside the Lexical
 * tree: the current H1-H5 heading list (FR-002/FR-005), which heading is at
 * the top of the viewport (FR-004, rAF-throttled for rapid-scroll/large-doc
 * performance), and the imperative scroll-to-heading action (FR-003) the
 * handle's `scrollToHeading` forwards to.
 *
 * Mounted only when a host supplies `documentOutlineHandle` to `<Editor>` —
 * an outline-less consumer pays nothing for this plugin.
 */
export function OutlinePlugin({ handle }: { handle: DocumentOutlineHandle }): null {
  const [editor] = useLexicalComposerContext();
  // Safe: every `DocumentOutlineHandle` a host can construct comes from
  // `createDocumentOutlineHandle()`, which always returns an `OutlineHandleImpl`.
  const impl = handle as OutlineHandleImpl;

  useEffect(() => {
    let entries: OutlineEntry[] = [];
    let activeIndex: number | null = null;
    // The scroll target starts as `window` and is redirected to the real
    // scrollable ancestor as soon as one is discoverable (see
    // `reattachScrollListener`). Fixing it once at mount would miss the
    // container entirely on a host whose scroll container isn't resolvable
    // yet at that instant (e.g. before any heading has rendered).
    let scrollTarget: HTMLElement | Window = window;

    const publish = () => {
      impl.publish({ entries, activeIndex });
    };

    let scheduledFrame = 0;
    const updateActive = () => {
      scheduledFrame = 0;
      const rootElement = editor.getRootElement();
      if (!rootElement) return;
      const headings = Array.from(rootElement.querySelectorAll<HTMLElement>(HEADING_SELECTOR));

      let next: number | null = null;
      if (headings.length > 0) {
        const container = scrollContainerFor(headings[0]);
        const referenceTop = container ? container.getBoundingClientRect().top : 0;
        next = 0;
        for (let i = 0; i < headings.length; i++) {
          if (headings[i].getBoundingClientRect().top - referenceTop <= 0) next = i;
          else break;
        }
        // Guards against a heading-DOM/entries mismatch rather than assuming
        // they always agree in length.
        if (next >= entries.length) next = entries.length > 0 ? entries.length - 1 : null;
      }

      if (next !== activeIndex) {
        activeIndex = next;
        publish();
      }
    };

    const scheduleUpdateActive = () => {
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(updateActive);
    };

    /**
     * Re-resolve the scroll container from the current DOM and move the
     * listener there if it changed. Called on every entries update — not
     * just once at mount — because the container is normally only
     * discoverable once at least one heading has actually rendered.
     */
    const reattachScrollListener = () => {
      const rootElement = editor.getRootElement();
      const firstHeading = rootElement?.querySelector<HTMLElement>(HEADING_SELECTOR) ?? null;
      const nextTarget: HTMLElement | Window = firstHeading ? scrollContainerFor(firstHeading) ?? window : window;
      if (nextTarget === scrollTarget) return;
      scrollTarget.removeEventListener('scroll', scheduleUpdateActive);
      nextTarget.addEventListener('scroll', scheduleUpdateActive, { passive: true });
      scrollTarget = nextTarget;
    };

    const updateEntries = () => {
      editor.getEditorState().read(() => {
        entries = readHeadingEntries();
      });
      if (activeIndex !== null && activeIndex >= entries.length) {
        activeIndex = entries.length > 0 ? entries.length - 1 : null;
      }
      reattachScrollListener();
      scheduleUpdateActive();
      publish();
    };

    updateEntries();
    const unregisterUpdateListener = editor.registerUpdateListener(updateEntries);

    impl.connect((index: number) => {
      const target = editor.getRootElement()?.querySelectorAll<HTMLElement>(HEADING_SELECTOR)[index];
      if (target) scrollElementIntoView(target);
    });

    return () => {
      unregisterUpdateListener();
      scrollTarget.removeEventListener('scroll', scheduleUpdateActive);
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      impl.disconnect();
    };
  }, [editor, impl]);

  return null;
}

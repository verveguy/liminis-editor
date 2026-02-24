import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

/**
 * Normalize text for anchor matching.
 * - Lowercase for case-insensitive comparison
 * - Normalize em-dash, en-dash, hyphen, underscore to space
 * - Collapse multiple whitespace to single space
 * - Trim leading/trailing whitespace
 */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[—–\-_]/g, ' ')  // em-dash, en-dash, hyphen, underscore → space
    .replace(/\s+/g, ' ')      // collapse whitespace
    .trim();
}

/**
 * AnchorScrollPlugin - Scrolls to headings when anchor links are clicked
 *
 * This plugin listens for `editor:scrollToAnchor` IPC events (sent from main process
 * when an anchor link like `[[#Heading Name]]` is clicked) and scrolls to the matching
 * heading in the document.
 *
 * The plugin:
 * 1. Subscribes to `editor:scrollToAnchor` events via preload API
 * 2. Finds headings by text matching (case-insensitive, normalizes special chars)
 * 3. Scrolls within the editor scroll container
 * 4. Cleans up the subscription on unmount
 */
export function AnchorScrollPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Early exit if the preload API is not available
    if (!window.api?.editor?.onScrollToAnchor) {
      return;
    }

    const unsubscribe = window.api.editor.onScrollToAnchor((anchor: string) => {
      const normalizedAnchor = normalizeForMatch(anchor);
      const rootElement = editor.getRootElement();

      if (!rootElement) {
        return;
      }

      // Query all headings using established CSS class pattern from editorTheme
      const selector = [
        '.editor-heading-h1',
        '.editor-heading-h2',
        '.editor-heading-h3',
        '.editor-heading-h4',
        '.editor-heading-h5',
      ].join(',');
      const headings = Array.from(rootElement.querySelectorAll(selector));

      // Find heading with matching text
      const heading = headings.find(h =>
        normalizeForMatch(h.textContent || '') === normalizedAnchor
      ) as HTMLElement | undefined;

      if (heading) {
        // Scroll within the editor scroll container only, not the entire window.
        // Using scrollIntoView() would scroll all ancestors including the app chrome.
        const container = heading.closest('#editor-scroll-container')
          || heading.closest('#editor-panel-scroll-container');
        if (container) {
          container.scrollTo({ top: heading.offsetTop, behavior: 'smooth' });
        }
      } else {
        console.warn('Anchor target not found:', anchor);
      }
    });

    return unsubscribe;
  }, [editor]);

  return null;
}

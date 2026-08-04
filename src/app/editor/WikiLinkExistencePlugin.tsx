import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEditorHost } from '../../host/context';

/**
 * WikiLinkExistencePlugin - Checks wiki-links and marks broken ones
 *
 * This plugin scans for wiki-links in the editor DOM and checks if their
 * target files exist anywhere in the workspace. Links to non-existent files
 * get a CSS class applied to render them in red.
 *
 * Uses the host-supplied `resolveWikiLinks` service, which handles:
 * - Directory links (e.g., "entities/teams/") → resolves to index.md or README.md
 * - File links with extension (e.g., "notes.md") → checks directly
 * - File links without extension (e.g., "notes") → tries .md, .mdc
 *
 * The check is performed:
 * - When the document is loaded
 * - When the document content changes (debounced)
 */
export function WikiLinkExistencePlugin() {
  const [editor] = useLexicalComposerContext();
  const { resolveWikiLinks } = useEditorHost();
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const checkWikiLinks = async () => {
      // Find all wiki-link elements
      const wikiLinks = rootElement.querySelectorAll('a[data-wiki-link="true"]');
      if (wikiLinks.length === 0) return;

      // Collect unique target paths
      const targets = new Set<string>();
      wikiLinks.forEach((link) => {
        const target = link.getAttribute('data-wiki-target');
        if (target) {
          targets.add(target);
        }
      });

      if (targets.size === 0) return;

      // Skip if we've already checked these exact targets
      const targetsArray = Array.from(targets);
      const targetKey = targetsArray.sort().join('|');
      if (lastCheckedRef.current.has(targetKey)) {
        return;
      }

      // Use the host-supplied resolver which handles directory links, etc.
      try {
        if (!resolveWikiLinks) {
          console.warn('[WikiLinkExistencePlugin] resolveWikiLinks host service not available');
          return;
        }

        // Resolve all wiki-link paths
        const resolved = await resolveWikiLinks(targetsArray);
        lastCheckedRef.current.add(targetKey);

        // Update CSS classes on wiki-links
        wikiLinks.forEach((link) => {
          const target = link.getAttribute('data-wiki-target');
          if (target) {
            // Link exists if resolver returned a non-null path
            const exists = resolved[target] !== null;
            if (!exists) {
              link.classList.add('editor-link-broken');
            } else {
              link.classList.remove('editor-link-broken');
            }
          }
        });
      } catch (err) {
        console.error('[WikiLinkExistencePlugin] Error checking wiki-link existence', err);
      }
    };

    // Debounced check function
    const scheduleCheck = () => {
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
      }
      checkTimeoutRef.current = setTimeout(() => { void checkWikiLinks() }, 300);
    };

    // Initial check
    scheduleCheck();

    // Listen for editor updates
    const unregisterListener = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Only re-check if there were actual changes
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
        // Clear the cache when content changes so we re-check
        lastCheckedRef.current.clear();
        scheduleCheck();
      }
    });

    return () => {
      unregisterListener();
      if (checkTimeoutRef.current) {
        clearTimeout(checkTimeoutRef.current);
      }
    };
  }, [editor, resolveWikiLinks]);

  return null;
}

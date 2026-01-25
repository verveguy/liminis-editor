import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

/**
 * WikiLinkExistencePlugin - Checks wiki-links and marks broken ones
 *
 * This plugin scans for wiki-links in the editor DOM and checks if their
 * target files exist anywhere in the workspace. Links to non-existent files
 * get a CSS class applied to render them in red.
 *
 * Wiki-links like [[notes]] get converted to URLs like "notes.md". This plugin
 * uses findFiles to search for files by name across the entire workspace,
 * since the file might exist in any directory (e.g., drafts/notes.md).
 *
 * The check is performed:
 * - When the document is loaded
 * - When the document content changes (debounced)
 */
export function WikiLinkExistencePlugin() {
  const [editor] = useLexicalComposerContext();
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const checkWikiLinks = async () => {
      // Find all wiki-link elements
      const wikiLinks = rootElement.querySelectorAll('a[data-wiki-link="true"]');
      if (wikiLinks.length === 0) return;

      // Collect unique target paths and map them to their filenames
      const targetToFilename = new Map<string, string>();
      wikiLinks.forEach((link) => {
        const target = link.getAttribute('data-wiki-target');
        if (target) {
          // Extract just the filename from the target
          // e.g., "notes.md" → "notes.md", "drafts/notes.md" → "notes.md"
          const filename = target.split('/').pop() || target;
          targetToFilename.set(target, filename);
        }
      });

      if (targetToFilename.size === 0) return;

      // Skip if we've already checked these exact targets
      const targetsArray = Array.from(targetToFilename.keys());
      const targetKey = targetsArray.sort().join('|');
      if (lastCheckedRef.current.has(targetKey)) {
        return;
      }

      // Find files by name across the workspace
      try {
        if (!window.api?.fs?.findFiles) {
          console.warn('[WikiLinkExistencePlugin] fs.findFiles not available');
          return;
        }

        // Get unique filenames to search for
        const filenames = Array.from(new Set(targetToFilename.values()));
        const foundFiles = await window.api.fs.findFiles(filenames);
        lastCheckedRef.current.add(targetKey);

        // Update CSS classes on wiki-links
        wikiLinks.forEach((link) => {
          const target = link.getAttribute('data-wiki-target');
          if (target) {
            const filename = targetToFilename.get(target);
            // File exists if findFiles returned a path for this filename
            const exists = filename ? foundFiles[filename] !== null : false;
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
  }, [editor]);

  return null;
}

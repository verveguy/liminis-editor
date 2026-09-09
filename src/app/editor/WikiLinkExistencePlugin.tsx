import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEditorHost } from '../../host/context';

/**
 * WikiLinkExistencePlugin - Checks wiki-links and marks broken ones
 *
 * This plugin scans for wiki-links in the editor DOM and checks if their
 * target files (or, for a block-scoped link, target block — #119) exist
 * anywhere in the workspace. Links that don't resolve get a CSS class
 * applied to render them in red.
 *
 * A plain file-only link (`data-wiki-target`, no `data-block-id`) uses the
 * host-supplied `resolveWikiLinks` service, which handles:
 * - Directory links (e.g., "entities/teams/") → resolves to index.md or README.md
 * - File links with extension (e.g., "notes.md") → checks directly
 * - File links without extension (e.g., "notes") → tries .md, .mdc
 *
 * A block-scoped link (`data-block-id` present, `[[file#^id]]`) instead
 * checks via `resolveTransclusion` — the same host resolver transclusion
 * uses for content, per the Plan's "one resolver, two consumers" decision.
 * `resolveTransclusion` returns content, not a boolean, but existence is
 * exactly "did this resolve to something non-null" (FR-004's edge case: an
 * id that doesn't exist is unresolved, not an error, with the same styling
 * an unresolved file-only wikilink already gets).
 *
 * The check is performed:
 * - When the document is loaded
 * - When the document content changes (debounced)
 */
export function WikiLinkExistencePlugin() {
  const [editor] = useLexicalComposerContext();
  const { resolveWikiLinks, resolveTransclusion } = useEditorHost();
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    const checkWikiLinks = async () => {
      // Find all wiki-link elements, split into plain (file-only) and
      // block-scoped (carrying data-block-id) groups.
      const wikiLinks = rootElement.querySelectorAll('a[data-wiki-link="true"]');
      if (wikiLinks.length === 0) return;

      const plainTargets = new Set<string>();
      const blockRefs = new Set<string>();
      wikiLinks.forEach((link) => {
        const target = link.getAttribute('data-wiki-target');
        if (!target) return;
        const blockId = link.getAttribute('data-block-id');
        if (blockId) {
          blockRefs.add(`${target}#^${blockId}`);
        } else {
          plainTargets.add(target);
        }
      });

      if (plainTargets.size === 0 && blockRefs.size === 0) return;

      // Skip if we've already checked this exact combination of targets.
      const checkKey = [...plainTargets, ...blockRefs].sort().join('|');
      if (lastCheckedRef.current.has(checkKey)) {
        return;
      }

      try {
        const plainResolved = await resolvePlainTargets(plainTargets, resolveWikiLinks);
        const blockResolved = await resolveBlockRefs(blockRefs, resolveTransclusion);
        lastCheckedRef.current.add(checkKey);

        // Update CSS classes on wiki-links
        wikiLinks.forEach((link) => {
          const target = link.getAttribute('data-wiki-target');
          if (!target) return;
          const blockId = link.getAttribute('data-block-id');
          const exists = blockId ? blockResolved.get(`${target}#^${blockId}`) : plainResolved.get(target);
          if (exists === false) {
            link.classList.add('editor-link-broken');
          } else {
            link.classList.remove('editor-link-broken');
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
  }, [editor, resolveWikiLinks, resolveTransclusion]);

  return null;
}

/**
 * Resolve plain (file-only) wiki-link targets via `resolveWikiLinks`.
 * Absent the resolver (or no targets to check), every target is left
 * unresolved-status `undefined` so the caller leaves its styling alone
 * rather than marking it broken — consistent with the rest of this host
 * seam's "service missing = feature unavailable, do nothing" convention.
 */
async function resolvePlainTargets(
  targets: Set<string>,
  resolveWikiLinks: ((targets: string[]) => Promise<Record<string, string | null>>) | undefined,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (targets.size === 0 || !resolveWikiLinks) {
    return result;
  }
  const resolved = await resolveWikiLinks([...targets]);
  for (const target of targets) {
    // A missing key (as opposed to an explicit `null`) is treated as
    // existing, matching this plugin's pre-#119 behavior — resolveWikiLinks
    // isn't contractually required to return an entry for every target, and
    // FR-014 requires plain wikilink resolution to be unaffected by this
    // feature.
    result.set(target, resolved[target] !== null);
  }
  return result;
}

/**
 * Resolve block-scoped references (`file#^blockId` keys) via
 * `resolveTransclusion`, one call per unique reference (the resolver's
 * contract is single-reference, unlike `resolveWikiLinks`'s batch shape).
 */
async function resolveBlockRefs(
  refs: Set<string>,
  resolveTransclusion: ((file: string, blockId: string) => Promise<string | null>) | undefined,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (refs.size === 0 || !resolveTransclusion) {
    return result;
  }
  await Promise.all(
    [...refs].map(async (ref) => {
      const separatorIndex = ref.indexOf('#^');
      const file = ref.slice(0, separatorIndex);
      const blockId = ref.slice(separatorIndex + 2);
      try {
        const content = await resolveTransclusion(file, blockId);
        result.set(ref, content !== null && content !== undefined);
      } catch {
        // FR-009: a rejected resolver is treated as "unresolved", not an error.
        result.set(ref, false);
      }
    }),
  );
  return result;
}

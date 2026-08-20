/**
 * Derives `OutlineEntry` entries directly from markdown text, independent of
 * any Lexical editor state — the raw-mode counterpart to `OutlinePlugin`'s
 * live-tree derivation (issue #84). A host with no mounted Lexical editor
 * (liminis#1022's raw markdown mode) has no heading DOM/tree to walk, but it
 * does have the markdown text and, per this issue's spec, is expected to know
 * which source line is currently in view — this module turns both into the
 * same `OutlineEntry` shape `OutlinePlugin` produces, plus a source line
 * neither Lexical nor the DOM can supply.
 */

import { parseMarkdown, isHeading, isText, isInlineCode } from '../../markdown/parse';
import type { Content, PhrasingContent } from 'mdast';
import type { OutlineEntry } from './documentOutlineHandle';

/**
 * Recursively reduces inline content to plain text, matching Lexical's
 * `getTextContent()` semantics: every inline node's text is concatenated in
 * order with no separator, bottoming out at `text`/`inlineCode` leaves. This
 * mirrors `OutlinePlugin.test.tsx`'s inline-code fixture (`'See ' + 'inline
 * code'` → `'See inline code'`) rather than enumerating every mdast inline
 * type by name.
 */
function extractText(node: Content | PhrasingContent): string {
  if (isText(node) || isInlineCode(node)) return node.value;
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((child) => extractText(child as Content | PhrasingContent)).join('');
  }
  return '';
}

/**
 * Derive `OutlineEntry[]` from a markdown string alone — no Lexical editor,
 * no DOM. Mirrors `OutlinePlugin.readHeadingEntries()`: only top-level nodes
 * are inspected (headings nested inside blockquotes/lists are not walked
 * into, matching `$getRoot().getChildren()`), levels are restricted to
 * H1–H5 (mdast allows depth 6; excluded exactly like the Lexical path
 * excludes H6), and identity is positional (`index`), not by `text`.
 *
 * Unlike the Lexical path, an empty-title heading is still included — see
 * ADR for why this issue does not replicate the pre-extraction app's
 * `if (!title) continue`.
 */
export function deriveOutlineFromMarkdown(markdown: string): OutlineEntry[] {
  const { root } = parseMarkdown(markdown);
  const entries: OutlineEntry[] = [];
  let index = 0;
  for (const node of root.children) {
    if (!isHeading(node)) continue;
    if (node.depth < 1 || node.depth > 5) continue;
    const text = node.children.map((child) => extractText(child)).join('');
    entries.push({
      index: index++,
      level: node.depth as OutlineEntry['level'],
      text,
      line: node.position?.start?.line,
    });
  }
  return entries;
}

/**
 * Resolve which entry is "active" for a supplied source `line` — the
 * raw-mode counterpart to `OutlinePlugin`'s viewport-based scroll-spy. An
 * entry is active from its own line up to (but not including) the next
 * entry's line, matching the spec's literal FR-006 semantics (no tolerance/
 * fudge factor — that is host-side scroll-spy tuning, per the plan).
 *
 * Returns `null` when `line` is `null` (no active heading yet, e.g. before
 * first scroll) or falls before the first heading.
 */
export function resolveActiveOutlineIndex(entries: OutlineEntry[], line: number | null): number | null {
  if (line === null) return null;
  let active: number | null = null;
  for (const entry of entries) {
    if (entry.line === undefined) continue;
    if (entry.line <= line) active = entry.index;
    else break;
  }
  return active;
}

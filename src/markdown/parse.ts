import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { defList } from 'micromark-extension-definition-list';
import { defListFromMarkdown } from 'mdast-util-definition-list';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { syntax as wikiLinkSyntax } from 'micromark-extension-wiki-link';
import * as wikiLinkMdast from './vendor/mdast-util-wiki-link';
import type { Root, Content, PhrasingContent } from 'mdast';

export interface ParseOptions {
  mathEnabled?: boolean;
}

export interface ParseResult {
  root: Root;
}

// Wiki-link options: use | as the alias divider (Obsidian/Foam style)
const wikiLinkOptions = { aliasDivider: '|' };
const EMPTY_ALIAS_SENTINEL = '__EMPTY_ALIAS__';

interface Replacement {
  normalizedStart: number;
  normalizedEnd: number;
  delta: number;
  originalStart: number;
  originalEnd: number;
}

/**
 * Escape pipes inside wiki-links: [[target|alias]] → [[target\|alias]]
 * This prevents GFM table parsing from splitting wiki-links at the pipe.
 * The vendored mdast-util-wiki-link strips the backslash during conversion.
 *
 * NOTE: Only escapes the FIRST pipe inside each wiki-link (the alias divider).
 * Additional pipes in the alias text are valid and should remain unescaped.
 */
function escapeWikiLinkPipes(text: string): { text: string; replacements: Replacement[] } {
  const replacements: Replacement[] = [];
  // Match [[ followed by non-] characters, then | (alias divider), then more content until ]]
  // Use non-greedy matching to handle multiple wiki-links
  const pattern = /\[\[([^\]|]+)\|([^\]]*)\]\]/g;

  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const originalStart = match.index;
    const originalEnd = match.index + match[0].length;
    const target = match[1];
    const alias = match[2];

    // Skip if pipe is already escaped (rare edge case where source has \|)
    // This would show up as target ending with \
    if (target.endsWith('\\')) {
      continue;
    }

    const replacement = `[[${target}\\|${alias}]]`;

    result += text.slice(cursor, originalStart);
    const normalizedStart = result.length;
    result += replacement;
    const normalizedEnd = result.length;

    replacements.push({
      normalizedStart,
      normalizedEnd,
      delta: replacement.length - match[0].length, // +1 for the backslash
      originalStart,
      originalEnd,
    });

    cursor = originalEnd;
  }

  result += text.slice(cursor);
  return { text: result, replacements };
}

/**
 * Combine two sets of replacements from sequential preprocessing steps.
 * The second set of replacements refers to positions in text AFTER the first set was applied.
 * We need to adjust the second set's original positions to refer to the true original text.
 */
function combineReplacements(first: Replacement[], second: Replacement[]): Replacement[] {
  if (first.length === 0) return second;
  if (second.length === 0) return first;

  // Adjust second replacements' original positions based on first replacements' deltas.
  // Uses a single-pass O(N+M) merge since both arrays are sorted by position.
  //
  // NOTE: This does not adjust the first set's normalizedStart/normalizedEnd for shifts
  // introduced by the second step. In practice this is fine because mapNormalizedOffsetToOriginal
  // is only used for emphasis/strong marker detection, and emphasis markers won't appear
  // inside wiki-links. If additional preprocessing steps or offset uses are added in the
  // future, this assumption should be revisited.
  const adjustedSecond: Replacement[] = [];
  let deltaAdjustment = 0;
  let firstIndex = 0;

  for (const rep of second) {
    // Advance through `first` to accumulate deltas from replacements before this position
    while (firstIndex < first.length && first[firstIndex].normalizedEnd <= rep.originalStart) {
      deltaAdjustment += first[firstIndex].delta;
      firstIndex++;
    }

    adjustedSecond.push({
      ...rep,
      originalStart: rep.originalStart - deltaAdjustment,
      originalEnd: rep.originalEnd - deltaAdjustment,
    });
  }

  // Merge and sort by normalizedStart
  return [...first, ...adjustedSecond].sort((a, b) => a.normalizedStart - b.normalizedStart);
}

/**
 * Normalize wiki-links with empty aliases: [[target|]] → [[target|__EMPTY_ALIAS__]]
 * We preserve the intent by using a sentinel, then strip it after parsing.
 * Returns the normalized text plus offset mapping data.
 */
function normalizeWikiLinks(text: string): { text: string; replacements: Replacement[] } {
  const replacements: Replacement[] = [];
  const pattern = /\[\[([^\]|]+)\|\]\]/g;

  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const originalStart = match.index;
    const originalEnd = match.index + match[0].length;
    const replacement = `[[${match[1]}|${EMPTY_ALIAS_SENTINEL}]]`;

    result += text.slice(cursor, originalStart);
    const normalizedStart = result.length;
    result += replacement;
    const normalizedEnd = result.length;

    replacements.push({
      normalizedStart,
      normalizedEnd,
      delta: replacement.length - match[0].length,
      originalStart,
      originalEnd,
    });

    cursor = originalEnd;
  }

  result += text.slice(cursor);
  return { text: result, replacements };
}

function mapNormalizedOffsetToOriginal(offset: number, replacements: Replacement[]): number {
  let delta = 0;
  for (const rep of replacements) {
    if (offset >= rep.normalizedEnd) {
      delta += rep.delta;
      continue;
    }
    if (offset >= rep.normalizedStart) {
      // Offset falls within a replacement; map to the start of the original span.
      return rep.originalStart;
    }
    break;
  }
  return offset - delta;
}

function annotateEmphasisMarkers(root: Root, originalText: string, replacements: Replacement[]): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if ((node.type === 'emphasis' || node.type === 'strong') && node.position?.start?.offset != null) {
      const normalizedOffset = node.position.start.offset as number;
      const originalOffset = mapNormalizedOffsetToOriginal(normalizedOffset, replacements);
      const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};

      if (node.type === 'emphasis') {
        const marker = originalText[originalOffset];
        if (marker === '_' || marker === '*') {
          data._emphasisMarker = marker;
        }
      } else if (node.type === 'strong') {
        const two = originalText.slice(originalOffset, originalOffset + 2);
        if (two === '__' || two === '**') {
          data._strongMarker = two[0];
        } else {
          const marker = originalText[originalOffset];
          if (marker === '_' || marker === '*') {
            data._strongMarker = marker;
          }
        }
      }

      node.data = data;
    }

    if (node.children && Array.isArray(node.children)) {
      node.children = node.children.map(walk);
    }

    return node;
  }

  return walk(root);
}

/**
 * Mark wiki-links that had an empty alias in the source.
 * Sets data._emptyAlias = true and clears alias to empty string.
 */
function markEmptyAliasWikiLinks(root: Root): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'wikiLink') {
      const alias = node.data?.alias;
      if (alias === EMPTY_ALIAS_SENTINEL) {
        return {
          ...node,
          data: { ...(node.data || {}), alias: '', _emptyAlias: true },
        };
      }
      return node;
    }

    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(walk),
      };
    }

    return node;
  }

  return walk(root);
}

/**
 * Strip trailing backslash from wiki-link values when they have an alias.
 * This handles the escaped pipe (\|) that was added by escapeWikiLinkPipes().
 *
 * NOTE: The vendored `mdast-util-wiki-link` (src/markdown/vendor/) already
 * strips this backslash during fromMarkdown() processing. This function serves
 * as defense-in-depth in case that strip is ever removed or a caller supplies a
 * different wiki-link mdast extension. In normal operation the condition
 * `node.value?.endsWith('\\')` will be false (already stripped upstream of here).
 */
function stripEscapedPipeFromWikiLinks(root: Root): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (node.type === 'wikiLink') {
      // Only strip if there's an alias (the backslash was only added when there's a pipe/alias)
      if (node.data?.alias && node.value?.endsWith('\\')) {
        return {
          ...node,
          value: node.value.slice(0, -1),
        };
      }
      return node;
    }

    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(walk),
      };
    }

    return node;
  }

  return walk(root);
}

// CommonMark's escapable ASCII punctuation set: a backslash followed by one
// of these is a genuine escape (consumed to the literal character); a
// backslash followed by anything else is a literal backslash.
const ESCAPABLE_PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));

// The subset of escapable punctuation this issue (#17) covers: characters
// whose escape must survive the round trip so it isn't reinterpreted on the
// next parse (see spec's "Assumptions" for why this list stops at seven).
const FORCE_ESCAPE_CHARS = new Set(['*', '_', '`', '[', ']', '#', '\\']);

interface DecodedPart {
  char: string;
  srcStart: number;
  srcEnd: number;
  escaped: boolean;
}

/**
 * Replay CommonMark's own backslash-escape decoding over a text node's raw
 * source span, character by character, so each decoded character can be
 * traced back to the exact source offset(s) it came from.
 */
function replayDecodeEscapes(source: string): { decoded: string; parts: DecodedPart[] } {
  const parts: DecodedPart[] = [];
  let decoded = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length && ESCAPABLE_PUNCTUATION.has(source[i + 1])) {
      const escaped = source[i + 1];
      parts.push({ char: escaped, srcStart: i, srcEnd: i + 2, escaped: true });
      decoded += escaped;
      i += 2;
    } else {
      parts.push({ char: ch, srcStart: i, srcEnd: i + 1, escaped: false });
      decoded += ch;
      i += 1;
    }
  }
  return { decoded, parts };
}

/**
 * Split a single `text` node into siblings wherever it contains a
 * backslash-escaped instance of one of the seven target characters, tagging
 * only that single-character node with `data._forceEscape = true`.
 *
 * Returns `[node]` unchanged whenever nothing needs protecting, or whenever
 * the source span's replayed decoding doesn't exactly reproduce `node.value`
 * (e.g. a character reference like `&amp;` in the span) — the latter is a
 * conservative bail-out, mirroring `recordOffsetSpan`'s own width-mismatch
 * guard in `mdastToLexical.ts`: a missed protection reproduces today's
 * existing defect, but a wrong split would corrupt text. Because
 * `fromMarkdown` merges a character reference and any surrounding literal
 * text (including an escaped target character) into one text node, a
 * character reference anywhere in the same run also suppresses protection
 * for an escape elsewhere in that run — a narrow, pre-existing-defect-shaped
 * limitation, not a new one.
 */
function splitTextNodeEscapes(node: any, normalizedText: string): any[] {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start == null || end == null) {
    return [node];
  }

  const source = normalizedText.slice(start, end);
  const { decoded, parts } = replayDecodeEscapes(source);
  if (decoded !== node.value) {
    return [node];
  }

  if (!parts.some((p) => p.escaped && FORCE_ESCAPE_CHARS.has(p.char))) {
    return [node];
  }

  const result: any[] = [];
  const startPos = node.position.start;
  // Per-offset line/column within `source`, walked once from the original
  // node's start position — `makeTextNode` below looks up the correct point
  // for each split node's start/end instead of copying the original node's
  // start position onto every sibling (which would leave every split node's
  // `end` reporting the same line/column as the original node's `start`).
  const positionAt: { line: number; column: number }[] = new Array(source.length + 1);
  {
    let line = startPos.line;
    let column = startPos.column;
    positionAt[0] = { line, column };
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      positionAt[i + 1] = { line, column };
    }
  }
  const makeTextNode = (value: string, srcStart: number, srcEnd: number, forceEscape: boolean): any => ({
    type: 'text',
    value,
    ...(forceEscape ? { data: { _forceEscape: true } } : {}),
    position: {
      start: { ...positionAt[srcStart - start], offset: srcStart },
      end: { ...positionAt[srcEnd - start], offset: srcEnd },
    },
  });

  let runStart = 0;
  const flushRun = (from: number, to: number): void => {
    if (to <= from) return;
    const value = parts.slice(from, to).map((p) => p.char).join('');
    result.push(makeTextNode(value, start + parts[from].srcStart, start + parts[to - 1].srcEnd, false));
  };

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].escaped && FORCE_ESCAPE_CHARS.has(parts[i].char)) {
      flushRun(runStart, i);
      result.push(makeTextNode(parts[i].char, start + parts[i].srcStart, start + parts[i].srcEnd, true));
      runStart = i + 1;
    }
  }
  flushRun(runStart, parts.length);

  return result;
}

/**
 * Walk the tree and split every `text` node containing a force-escaped
 * character (see `splitTextNodeEscapes`) into siblings. Run last, after all
 * other parse post-processing, so nothing downstream needs to reason about
 * multi-node text runs that used to be a single node.
 */
function splitEscapedPunctuation(root: Root, normalizedText: string): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (node.children && Array.isArray(node.children)) {
      const children: any[] = [];
      for (const child of node.children) {
        if (child?.type === 'text') {
          children.push(...splitTextNodeEscapes(child, normalizedText));
        } else {
          children.push(walk(child));
        }
      }
      return { ...node, children };
    }

    return node;
  }

  return walk(root);
}

/**
 * Post-process mdast tree to support checkboxes in ordered lists.
 * 
 * GFM task lists only work with unordered lists (- [ ]), but Foam/Obsidian
 * commonly use them in ordered lists too (1. [ ]). The GFM parser leaves
 * the checkbox text as regular text in ordered lists.
 * 
 * This function finds ordered list items that start with [ ] or [x] text
 * and converts them to proper task list items by:
 * 1. Setting the checked property on the list item
 * 2. Removing the checkbox text from the content
 */
function addCheckboxesToOrderedLists(root: Root): Root {
  function processNode(node: any): any {
    if (node.type === 'list' && node.ordered === true) {
      // Process children (list items)
      return {
        ...node,
        children: node.children.map((listItem: any) => processOrderedListItem(listItem)),
      };
    }
    
    // Recursively process children for other node types
    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(processNode),
      };
    }
    
    return node;
  }
  
  function processOrderedListItem(listItem: any): any {
    // List item should have checked: null for non-task items
    // Check if the first paragraph starts with [ ] or [x]
    if (listItem.children && listItem.children.length > 0) {
      const firstChild = listItem.children[0];
      if (firstChild.type === 'paragraph' && firstChild.children && firstChild.children.length > 0) {
        const firstInline = firstChild.children[0];
        if (firstInline.type === 'text') {
          const text = firstInline.value;
          // Match [ ] or [x] or [X] at the start
          const checkboxMatch = text.match(/^\[( |x|X)\]\s*/);
          if (checkboxMatch) {
            const isChecked = checkboxMatch[1].toLowerCase() === 'x';

            // Mark as checked but keep the original text intact.
            // This preserves "[ ]" in the editor and lets export detect it later.
            return {
              ...listItem,
              checked: isChecked,
            };
          }
        }
      }
    }

    return listItem;
  }
  
  return processNode(root);
}

export function parseMarkdown(text: string, _options: ParseOptions = {}): ParseResult {
  // Pre-process to handle edge cases
  // Step 1: Escape pipes inside wiki-links to protect from GFM table parsing
  const { text: pipesEscaped, replacements: pipeReplacements } = escapeWikiLinkPipes(text);

  // Step 2: Normalize empty aliases (existing logic)
  const { text: normalizedText, replacements: aliasReplacements } = normalizeWikiLinks(pipesEscaped);

  // Combine replacements for offset mapping (pipeReplacements first, then adjust aliasReplacements)
  const replacements = combineReplacements(pipeReplacements, aliasReplacements);

  let root = fromMarkdown(normalizedText, {
    extensions: [gfm(), math(), defList, gfmFootnote(), frontmatter(['yaml']), wikiLinkSyntax(wikiLinkOptions)],
    mdastExtensions: [
      gfmFromMarkdown(),
      mathFromMarkdown(),
      defListFromMarkdown,
      gfmFootnoteFromMarkdown(),
      frontmatterFromMarkdown(['yaml']),
      wikiLinkMdast.fromMarkdown(wikiLinkOptions),
    ],
  } as any);

  // Post-process: add checkbox support for ordered lists
  // GFM only supports task lists in unordered lists, but Foam/Obsidian use them in ordered lists too
  root = addCheckboxesToOrderedLists(root);

  // Post-process: strip escaped pipe backslash from wiki-link targets
  root = stripEscapedPipeFromWikiLinks(root);

  // Post-process: mark wiki-links that had empty aliases in the source
  root = markEmptyAliasWikiLinks(root);

  // Post-process: annotate emphasis/strong marker characters from original source
  root = annotateEmphasisMarkers(root, text, replacements);

  // Post-process: split out backslash-escaped punctuation so its escape can
  // be carried through Lexical and restored at stringify time (#17)
  root = splitEscapedPunctuation(root, normalizedText);

  return { root };
}

// Type guards for mdast nodes
export function isParagraph(node: Content): node is Extract<Content, { type: 'paragraph' }> {
  return node.type === 'paragraph';
}

export function isHeading(node: Content): node is Extract<Content, { type: 'heading' }> {
  return node.type === 'heading';
}

export function isList(node: Content): node is Extract<Content, { type: 'list' }> {
  return node.type === 'list';
}

export function isListItem(node: Content): node is Extract<Content, { type: 'listItem' }> {
  return node.type === 'listItem';
}

export function isBlockquote(node: Content): node is Extract<Content, { type: 'blockquote' }> {
  return node.type === 'blockquote';
}

export function isCode(node: Content): node is Extract<Content, { type: 'code' }> {
  return node.type === 'code';
}

export function isThematicBreak(node: Content): node is Extract<Content, { type: 'thematicBreak' }> {
  return node.type === 'thematicBreak';
}

export function isTable(node: Content): node is Extract<Content, { type: 'table' }> {
  return node.type === 'table';
}

export function isImage(node: Content | PhrasingContent): node is Extract<Content, { type: 'image' }> {
  return node.type === 'image';
}

export function isLink(node: Content | PhrasingContent): node is Extract<Content, { type: 'link' }> {
  return node.type === 'link';
}

export function isHtml(node: Content): node is Extract<Content, { type: 'html' }> {
  return node.type === 'html';
}

export function isText(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'text' }> {
  return node.type === 'text';
}

export function isStrong(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'strong' }> {
  return node.type === 'strong';
}

export function isEmphasis(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'emphasis' }> {
  return node.type === 'emphasis';
}

export function isInlineCode(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'inlineCode' }> {
  return node.type === 'inlineCode';
}

export function isDelete(node: Content | PhrasingContent): node is Extract<PhrasingContent, { type: 'delete' }> {
  return node.type === 'delete';
}

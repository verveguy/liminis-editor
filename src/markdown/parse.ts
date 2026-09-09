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

// Private-Use-Area sentinel marking a `!` that immediately precedes `[[`
// (candidate transclusion/embed marker, #119). The next free codepoint after
// `annotate-sentinels.ts`'s E000-E003 range and `stringify.ts`'s E004.
//
// Why substitute at all, rather than just checking "does the wikiLink node
// have a `!` text sibling" after parsing: the micromark wiki-link tokenizer
// is not vendored (see the vendor README) and only hooks the `[` character.
// A literal `!` immediately before `[[` is claimed *first* by the default
// image-label-start construct (hooked on `!`), and when that construct fails
// to find a following `(url)`/`[ref]` — which it always will here, since
// `[[target]]` is not image syntax — CommonMark's own bracket-resolution
// falls the *entire* `![[target]]` span back to one literal text node,
// without ever giving the wiki-link tokenizer a chance to fire on the inner
// `[[`. A backslash-escaped `\!` sidesteps the image construct entirely (it
// is consumed as a plain escaped character, not a construct trigger) and
// `[[target]]` parses normally — confirmed empirically against
// `micromark-extension-wiki-link@0.0.4`'s tokenizer. Swapping the raw `!`
// for this sentinel *before* parsing reproduces that same escape-shaped
// bypass without a real backslash reaching the output, so `[[target]]` parses
// as a normal wikiLink node with the sentinel left on the preceding text
// node — which `resolveWikiEmbeds` (below) then reads to decide embed vs.
// plain link, and always strips before the tree leaves `parseMarkdown`.
const EMBED_MARKER_SENTINEL = '\u{E005}';

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
 * Swap a `!` for {@link EMBED_MARKER_SENTINEL}, but only when it is
 * immediately followed by a *complete, single-line* `[[...]]` span with no
 * internal `]` — i.e. exactly the shape the wiki-link tokenizer's own
 * `consumeTarget`/`consumeAlias` states require to succeed (a bare `]` not
 * immediately followed by a second `]` aborts the whole construct; so does a
 * line ending). One codepoint swapped for one codepoint, so — unlike
 * `escapeWikiLinkPipes`/`normalizeWikiLinks` above — this never shifts any
 * subsequent offset and needs no `Replacement` tracking of its own.
 *
 * The "complete span" requirement is load-bearing, not a nicety: an `!`
 * immediately before `[` is *also* how a real image's alt text starting with
 * a literal `[` looks at the character level (`![[leading] bracket](x.png)`
 * is `![` + alt text `[leading] bracket` + `](x.png)`, i.e. contains the raw
 * substring `![[`). Matching on `!(?=\[\[)` alone — with no lookahead past
 * the second `[` — can't tell that case apart from a genuine embed candidate
 * and would substitute inside it, preventing the image construct (which
 * needs the literal `!`) from ever being tried and corrupting the image
 * (caught by the `903-image-alt-leading-bracket` regression fixture).
 * Requiring the run between `[[` and `]]` to contain no internal `]` rules
 * that case out: `[leading] bracket](x.png)` hits an un-doubled `]` right
 * after `leading`, so the pattern below never matches there, `!` survives
 * untouched, and the image construct parses exactly as before this feature
 * existed (FR-014).
 *
 * A `!` that is already backslash-escaped (`\![[...]]`) is left alone: that
 * spelling already means "literal `!`, then a normal wiki-link" with no
 * substitution needed (CommonMark consumes the escape before the image
 * construct ever sees the `!`) — see FR-013's requirement that an author can
 * explicitly opt out of transclusion for a `#^id`-bearing target.
 *
 * "Escaped" here means CommonMark backslash-*parity*, not merely "a `\`
 * immediately precedes the `!`": an even run of backslashes (`\\!`, `\\\\!`,
 * ...) pairs off into literal backslashes and does not escape the `!`, while
 * an odd run (`\!`, `\\\!`, ...) does. A naive one-character lookbehind gets
 * every even run ≥ 2 wrong (treats the `!` as escaped when it isn't), so the
 * preceding backslash run is captured and its length checked explicitly.
 *
 * A match inside a fenced code block or inline code span must be skipped
 * entirely, not just left un-embedded: inside those constructs the wiki-link
 * tokenizer never runs at all (code content is verbatim), so a substituted
 * sentinel would never get a `wikiLink` node to attach to and restore from —
 * `resolveWikiEmbeds`'s leftover-sentinel sweep only walks `text` nodes, not
 * a `code`/`inlineCode` node's `value`, so the sentinel would otherwise leak
 * through as a literal, invisible Private-Use-Area character in the final
 * output instead of being restored to `!`. {@link findProtectedRanges}
 * identifies those spans so the substitution can leave them untouched.
 */
function substituteEmbedMarker(text: string): string {
  const protectedRanges = findProtectedRanges(text);
  return text.replace(
    /(\\*)!(\[\[[^\]\n]*\]\])/g,
    (match, backslashes: string, bracketed: string, offset: number) => {
      if (protectedRanges.some((r) => offset >= r.start && offset < r.end)) {
        return match;
      }
      return backslashes.length % 2 === 1
        ? `${backslashes}!${bracketed}`
        : `${backslashes}${EMBED_MARKER_SENTINEL}${bracketed}`;
    },
  );
}

interface TextRange {
  start: number;
  end: number;
}

/**
 * Finds fenced code blocks and inline code spans in raw markdown text, so
 * {@link substituteEmbedMarker} can avoid mutating their (verbatim) content.
 * Deliberately approximate rather than a full CommonMark tokenizer — good
 * enough to protect the common cases (``` fences, `inline` spans) without
 * duplicating the real tokenizer this file elsewhere avoids vendoring.
 */
function findProtectedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];

  // Fenced code blocks: a line of (up to 3 leading spaces then) 3+ backticks
  // or tildes opens one; it's closed by a later line of at least as many of
  // the same character (optionally indented, nothing else on the line).
  const fenceOpenRe = /^ {0,3}(`{3,}|~{3,})/;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let fenceStart = -1;
  let cursor = 0;
  for (const line of text.split('\n')) {
    const lineEnd = cursor + line.length;
    if (fenceChar === null) {
      const m = fenceOpenRe.exec(line);
      if (m) {
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        fenceStart = cursor;
      }
    } else {
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(line)) {
        ranges.push({ start: fenceStart, end: lineEnd });
        fenceChar = null;
        fenceLen = 0;
        fenceStart = -1;
      }
    }
    cursor = lineEnd + 1; // +1 for the '\n' consumed by split
  }
  if (fenceChar !== null) {
    ranges.push({ start: fenceStart, end: text.length });
  }

  // Inline code spans, outside any fenced block already found: a backtick
  // run opens a span, closed by the next run of the *same* length (a run of
  // a different length is span content, not a delimiter) — CommonMark's own
  // code-span rule. An opening run with no matching close is not a code
  // span at all (its backticks are literal), so it protects nothing.
  const isInFence = (pos: number) => ranges.some((r) => pos >= r.start && pos < r.end);
  const backtickRun = /`+/g;
  let pendingOpen: { start: number; len: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = backtickRun.exec(text)) !== null) {
    if (isInFence(match.index)) continue;
    const len = match[0].length;
    if (pendingOpen === null) {
      pendingOpen = { start: match.index, len };
    } else if (len === pendingOpen.len) {
      ranges.push({ start: pendingOpen.start, end: match.index + len });
      pendingOpen = null;
    }
  }

  return ranges;
}

/**
 * Retype a `wikiLink` node to `wikiEmbed` when it was immediately preceded by
 * an {@link EMBED_MARKER_SENTINEL} *and* carries a `data.blockId` (#119).
 *
 * Two outcomes when a sentinel-terminated text node precedes a `wikiLink`:
 *  - **Has `blockId`**: this is a genuine transclusion. Strip the sentinel
 *    off the preceding text (dropping the text node entirely if it was the
 *    sentinel alone) and retype the node to `wikiEmbed`, carrying the same
 *    `value`/`data`.
 *  - **No `blockId`**: FR-013 — `![[file]]` with no anchor is not a supported
 *    construct in v1. Restore the literal `!` in the preceding text and leave
 *    the node as an ordinary `wikiLink`, so it degrades to ordinary
 *    file-only link treatment (no embedding), matching what plain
 *    `\![[file]]` already does without any sentinel involved.
 *
 * A final sweep restores any sentinel left over from a `!` that didn't end up
 * immediately before a completed `wikiLink` (e.g. the target never closed) —
 * this sentinel must never leak into rendered/round-tripped content.
 */
function resolveWikiEmbeds(root: Root): Root {
  function walkChildren(children: any[]): any[] {
    const result: any[] = [];
    for (const rawChild of children) {
      const child = walk(rawChild);
      if (child?.type === 'wikiLink' && result.length > 0) {
        const prevIndex = result.length - 1;
        const prev = result[prevIndex];
        if (prev.type === 'text' && typeof prev.value === 'string' && prev.value.endsWith(EMBED_MARKER_SENTINEL)) {
          const blockId = child.data?.blockId;
          const hasBlockId = typeof blockId === 'string' && blockId.length > 0;
          const strippedValue = prev.value.slice(0, -1);
          if (hasBlockId) {
            if (strippedValue.length === 0) {
              result.pop();
            } else {
              result[prevIndex] = { ...prev, value: strippedValue };
            }
            result.push({ ...child, type: 'wikiEmbed' });
            continue;
          }
          result[prevIndex] = { ...prev, value: strippedValue + '!' };
          result.push(child);
          continue;
        }
      }
      result.push(child);
    }
    return result;
  }

  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (node.children && Array.isArray(node.children)) {
      return { ...node, children: walkChildren(node.children) };
    }
    return node;
  }

  function restoreLeftoverSentinels(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'text' && typeof node.value === 'string' && node.value.includes(EMBED_MARKER_SENTINEL)) {
      return { ...node, value: node.value.split(EMBED_MARKER_SENTINEL).join('!') };
    }
    if (node.children && Array.isArray(node.children)) {
      return { ...node, children: node.children.map(restoreLeftoverSentinels) };
    }
    return node;
  }

  return restoreLeftoverSentinels(walk(root));
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

// Branch A: detects a block anchor (`^ULID`) at its *definition* site — a
// bare caret immediately followed by a 26-character, uppercase Crockford
// Base32 run (ULIDs) — Douglas Crockford's Base32 alphabet, which excludes
// I, L, O and U to avoid visual confusion with 1/1/0/V. The trailing
// negative lookahead stops a longer or malformed run of the same charset
// from badging a truncated 26-character prefix of itself (issue #122).
// Frozen exactly as shipped for #122, with no position constraint, so every
// existing fixture and unit test that depends on a ULID badging regardless
// of what precedes or follows it on the line keeps matching byte-for-byte
// (#124/FR-004). See ADR-122's amendment for why ULID keeps this permissive
// rule while every other id form is handled by Branch B below.
const ULID_AT_CARET = /^\^[0-9A-HJKMNP-TV-Z]{26}(?![0-9A-HJKMNP-TV-Z])/;

// Branch B: any other id shape the resolver and the reference-side wiki-link
// parser already accept (`[^\s\]#]+` — `vendor/mdast-util-wiki-link/from-markdown.ts`
// and `liminis-app/src/main/fs.ts`'s resolver), gated by the resolver's own
// position rule — `/(?:^|\s)\^([^\s\]#]+)\s*$/` — instead of any charset or
// length test: the caret must start a token (line-start or preceded by
// whitespace), and the captured id must run to end of line (trailing
// spaces/tabs allowed). This is what makes badge and resolver agree by
// construction (#124/FR-002) for every id form *other* than ULID, without
// touching ULID's own permissive rule or the fixtures that depend on it
// (see ADR-122's amendment and the Plan stage's "Key Decisions").
const WIDE_ID_CHAR = /[^\s\]#]/;
const isSpaceOrTab = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

interface BlockAnchorMatch {
  /** Start offset (the `^`) within `decoded`. */
  index: number;
  /** Full match length, including the leading `^`. */
  length: number;
}

/**
 * Find every block-anchor match in `decoded`, trying Branch A (ULID, no
 * position constraint) before Branch B (any id shape, position-gated) at
 * each unescaped `^`, left to right, so a caret already consumed by one
 * branch's match is never re-considered by the other.
 *
 * Branch B's boundary checks peek one character outside this text node's
 * own `decoded`/`source` span — into `normalizedText` at `start - 1` (left)
 * or from `end` onward (right) — rather than inspecting sibling AST nodes:
 * the raw source character is equivalent and needs no tree traversal (see
 * Plan stage's "Key Decisions"). This is what lets Branch B correctly
 * refuse a match immediately followed by more prose on the same line, even
 * when that prose lives in a following sibling node (e.g. a wiki-link right
 * after the id), and correctly accept one immediately after a preceding
 * sibling ends with whitespace.
 */
function findBlockAnchorMatches(
  decoded: string,
  parts: DecodedPart[],
  normalizedText: string,
  start: number,
  end: number,
): BlockAnchorMatch[] {
  const matches: BlockAnchorMatch[] = [];
  let cursor = 0;

  for (let i = 0; i < decoded.length; i++) {
    if (i < cursor) continue;
    if (decoded[i] !== '^' || parts[i].escaped) continue;

    const branchA = ULID_AT_CARET.exec(decoded.slice(i));
    if (branchA) {
      matches.push({ index: i, length: branchA[0].length });
      cursor = i + branchA[0].length;
      continue;
    }

    // Left boundary: preceded by whitespace, or true document start.
    const leftOk = i > 0 ? /\s/.test(decoded[i - 1]) : start === 0 || /\s/.test(normalizedText[start - 1]);
    if (!leftOk) continue;

    // Id capture: greedy run of non-whitespace, non-`]`, non-`#`, tested
    // against `decoded` rather than raw source. A backslash-escaped `#` or
    // `]` inside an id (`^abc\#def`) therefore truncates the capture one
    // character earlier than a regex run over raw, undecoded file text
    // would (the resolver's own matching model) — but this never produces a
    // badge/resolver disagreement: whatever follows the truncation point is
    // identical, non-whitespace content in both the decoded and raw views
    // (backslash-escaping only ever turns `\X` into `X`, never anything
    // into whitespace), so the right-boundary check below rejects the match
    // in both models alike whenever this truncation is reachable. See the
    // "does not badge an id containing a backslash-escaped delimiter"
    // regression test.
    let idEnd = i + 1;
    while (idEnd < decoded.length && WIDE_ID_CHAR.test(decoded[idEnd])) idEnd++;
    if (idEnd === i + 1) continue; // empty capture, e.g. `a ^ b`

    // Right boundary: only trailing spaces/tabs before end of line or end of
    // document — peeking past this node's own end into `normalizedText` if
    // the capture runs all the way to it.
    let j = idEnd;
    while (j < decoded.length && isSpaceOrTab(decoded[j])) j++;
    let rightOk: boolean;
    if (j < decoded.length) {
      rightOk = decoded[j] === '\n';
    } else {
      let pos = end;
      while (pos < normalizedText.length && isSpaceOrTab(normalizedText[pos])) pos++;
      rightOk = pos === normalizedText.length || normalizedText[pos] === '\n';
    }
    if (!rightOk) continue;

    matches.push({ index: i, length: idEnd - i });
    cursor = idEnd;
  }

  return matches;
}

/**
 * Split a single `text` node into `[before, blockAnchor, after, ...]`
 * siblings wherever it contains a {@link findBlockAnchorMatches} match,
 * mirroring `splitTextNodeEscapes`'s decode-replay + position-mapping
 * machinery exactly (including its conservative bail-out when replayed
 * decoding doesn't exactly reproduce `node.value`, e.g. a character
 * reference in the span) rather than duplicating it (#122).
 *
 * Because this only ever inspects a `text` node's own `value` (plus, for
 * Branch B's boundary checks, one character immediately outside it), it can
 * never see into `inlineCode`, `code`, `inlineMath`, `wikiLink` or
 * `wikiEmbed` node content — none of those are `text` nodes once mdast has
 * typed them — which satisfies the code-span/fenced-code/math edge case and
 * FR-006 by construction, with no "protected ranges" pre-parse machinery
 * needed.
 */
function splitTextNodeBlockAnchors(node: any, normalizedText: string): any[] {
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

  // A caret whose leading `^` came from a backslash escape (`\^`) in the
  // source is never a match candidate — `findBlockAnchorMatches` checks
  // `parts[i].escaped` itself before trying either branch. `decoded` has
  // already resolved `\^` to a plain `^`, so nothing downstream can tell the
  // two apart on its own; an author who deliberately escaped a caret meant
  // literal text, not an anchor, and `stringify.ts`'s `blockAnchor` handler
  // always emits a bare `^id` with no escaping, so badging it would silently
  // drop the escape on the next save.
  const matches = findBlockAnchorMatches(decoded, parts, normalizedText, start, end);
  if (matches.length === 0) {
    return [node];
  }

  const startPos = node.position.start;
  // Per-offset line/column within `source`, mirroring splitTextNodeEscapes.
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
  const makePosition = (srcStart: number, srcEnd: number): any => ({
    start: { ...positionAt[srcStart - start], offset: srcStart },
    end: { ...positionAt[srcEnd - start], offset: srcEnd },
  });
  const makeTextNode = (value: string, srcStart: number, srcEnd: number): any => ({
    type: 'text',
    value,
    position: makePosition(srcStart, srcEnd),
  });

  const result: any[] = [];
  let cursor = 0; // index into `parts`/`decoded`
  for (const match of matches) {
    const matchStart = match.index;
    const matchEnd = matchStart + match.length;

    if (matchStart > cursor) {
      const value = parts.slice(cursor, matchStart).map((p) => p.char).join('');
      result.push(makeTextNode(value, start + parts[cursor].srcStart, start + parts[matchStart - 1].srcEnd));
    }

    // Captured from raw `source`, not `decoded`: stringify.ts's `blockAnchor`
    // handler re-emits `^${node.id}` verbatim with no escaping, so the id
    // must already carry any backslash the author wrote (e.g. `^ab\_cd`) or
    // that escape is silently dropped on the next save — a round-trip
    // corruption distinct from, and not covered by, the decoded-vs-raw
    // truncation reasoning above (that reasoning only shows the *match
    // boundary* never diverges; it says nothing about what ends up inside
    // an id that does match).
    result.push({
      type: 'blockAnchor',
      id: source.slice(parts[matchStart + 1].srcStart, parts[matchEnd - 1].srcEnd),
      position: makePosition(start + parts[matchStart].srcStart, start + parts[matchEnd - 1].srcEnd),
    });

    cursor = matchEnd;
  }

  if (cursor < parts.length) {
    const value = parts.slice(cursor, parts.length).map((p) => p.char).join('');
    result.push(makeTextNode(value, start + parts[cursor].srcStart, start + parts[parts.length - 1].srcEnd));
  }

  return result;
}

/**
 * Walk the tree and split every `text` node containing a block anchor (see
 * `splitTextNodeBlockAnchors`) into siblings. Run after `resolveWikiEmbeds`/
 * `annotateEmphasisMarkers` (so this never sees wiki-link/embed target text —
 * FR-006) and before `splitEscapedPunctuation` (so that pass still sees, and
 * can process, any escaped punctuation left in this split's "before"/"after"
 * text siblings) (#122).
 */
function splitBlockAnchors(root: Root, normalizedText: string): Root {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;

    if (node.children && Array.isArray(node.children)) {
      const children: any[] = [];
      for (const child of node.children) {
        if (child?.type === 'text') {
          children.push(...splitTextNodeBlockAnchors(child, normalizedText));
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
  // Step 0: Swap a `!` immediately before `[[` for a sentinel so the
  // wiki-link tokenizer gets a chance to fire (#119; see EMBED_MARKER_SENTINEL).
  // Same-length, so it needs no offset-replacement tracking of its own.
  const embedMarked = substituteEmbedMarker(text);

  // Step 1: Escape pipes inside wiki-links to protect from GFM table parsing
  const { text: pipesEscaped, replacements: pipeReplacements } = escapeWikiLinkPipes(embedMarked);

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

  // Post-process: retype a sentinel-preceded wiki-link with a blockId to a
  // transclusion/embed node, and restore the literal `!` everywhere else (#119)
  root = resolveWikiEmbeds(root);

  // Post-process: annotate emphasis/strong marker characters from original source
  root = annotateEmphasisMarkers(root, text, replacements);

  // Post-process: split a bare `^ULID` block anchor out of its surrounding
  // text so it can render as a badge instead of raw text (#122)
  root = splitBlockAnchors(root, normalizedText);

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

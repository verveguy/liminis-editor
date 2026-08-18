import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { defListToMarkdown } from 'mdast-util-definition-list';
import { gfmFootnoteToMarkdown } from 'mdast-util-gfm-footnote';
import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import type { Root } from 'mdast';
import { stripAnnotateSentinels, splitOnSentinelTokens } from './annotate-sentinels';

export interface StringifyOptions {
  wrapWidth?: number;
  bulletStyle?: '-' | '*' | '+';
  fenceStyle?: '`' | '~';
}

// Wiki-link options: use | as the alias divider (Obsidian/Foam style)
const wikiLinkOptions = { aliasDivider: '|' };

/**
 * Compute the mdast `spread` property on lists and list items, which
 * controls whether blank lines are added between items (and, for a list
 * item, between that item's own children).
 *
 * The incoming `node.spread` (already set by lexicalToMdast.ts's
 * convertListNode/convertListItemNode from the list's CustomListNode, which
 * carries the source document's original loose/tight state through the
 * round trip) is the baseline and is never downgraded to false here — that
 * would silently re-introduce the loose-list-forced-tight defect. It can
 * only be upgraded to true: an item needs its own children ("spread")
 * blank-line-separated when it holds more than one non-nested-list child
 * (multiple paragraphs, or a paragraph alongside a code block/table/
 * blockquote): abutting them with no blank line is ambiguous or misparses
 * on the way back in. A nested list doesn't count towards this — it already
 * reads unambiguously right after preceding content with no blank line.
 * Per CommonMark, if any item in a list is "loose", the whole list must
 * render loose too, or re-parsing collapses the blank lines and misreads
 * item boundaries — so a list's spread is the OR of its own baseline and its
 * items' spread.
 */
function computeListSpread(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.type === 'listItem') {
    const children = (node.children || []).map(computeListSpread);
    const nonListChildCount = children.filter((c: any) => c.type !== 'list').length;
    return {
      ...node,
      spread: node.spread === true || nonListChildCount > 1,
      children,
    };
  }

  if (node.type === 'list') {
    const children = (node.children || []).map(computeListSpread);
    return {
      ...node,
      spread: node.spread === true || children.some((item: any) => item.spread === true),
      children,
    };
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(computeListSpread),
    };
  }

  return node;
}

/**
 * Add checkbox text to ordered list items that have checked property.
 * 
 * GFM only outputs checkboxes ([ ] or [x]) for unordered lists.
 * For ordered lists with checkboxes (common in Foam/Obsidian), we need to
 * manually add the checkbox text to the first paragraph.
 */
function addCheckboxTextToOrderedLists(root: any): any {
  function processNode(node: any): any {
    if (node.type === 'list' && node.ordered === true) {
      return {
        ...node,
        children: node.children.map((listItem: any) => {
          // Only process list items that have a checked property
          if (listItem.checked === true || listItem.checked === false) {
            const checkbox = listItem.checked ? '[x] ' : '[ ] ';
            
            // Find the first paragraph and prepend the checkbox text
            if (listItem.children && listItem.children.length > 0) {
              const firstChild = listItem.children[0];
              if (firstChild.type === 'paragraph' && firstChild.children && firstChild.children.length > 0) {
                const firstInline = firstChild.children[0];
                if (firstInline.type === 'text') {
                  // If text already starts with a checkbox marker, don't duplicate it
                  if (firstInline.value.match(/^\[( |x|X)\]\s+/)) {
                    return listItem;
                  }
                  // Prepend checkbox to existing text
                  return {
                    ...listItem,
                    checked: null, // Clear checked so gfm doesn't output it again
                    children: [
                      {
                        ...firstChild,
                        children: [
                          { ...firstInline, value: checkbox + firstInline.value },
                          ...firstChild.children.slice(1),
                        ],
                      },
                      ...listItem.children.slice(1),
                    ],
                  };
                } else {
                  // First inline is not text, insert checkbox text before it
                  return {
                    ...listItem,
                    checked: null,
                    children: [
                      {
                        ...firstChild,
                        children: [
                          { type: 'text', value: checkbox },
                          ...firstChild.children,
                        ],
                      },
                      ...listItem.children.slice(1),
                    ],
                  };
                }
              }
            }
          }
          return listItem;
        }),
      };
    }
    
    // Recursively process children
    if (node.children && Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(processNode),
      };
    }
    
    return node;
  }
  
  return processNode(root);
}

// Transient placeholder codepoint wrapping a force-escaped character during
// stringification (#17). Distinct from `annotate-sentinels.ts`'s E000-E003
// range, module-local to this file, and never exported: it exists only
// between `convertForceEscapeTextNodes` (below) and the final
// placeholder-restoration post-process at the end of `stringifyMarkdown`, on
// a mdast tree reconstructed fresh from Lexical at export time and discarded
// immediately after — it never touches Lexical or live document state. Being
// backslash-free, it is provably invisible to the existing intraword-
// underscore and bracket-preservation post-processes below, so neither one
// needs to change to account for it.
const FORCE_ESCAPE_PLACEHOLDER = '\u{E004}';

// The character class the placeholder-restoration post-process (below) is
// allowed to wrap in a backslash. Kept narrow — rather than matching any
// character between two placeholder codepoints — so that if the placeholder
// codepoint itself ever showed up in real content (e.g. pasted from
// somewhere, or inside a code span the pre-process didn't anticipate), this
// step can't misfire and inject a backslash in front of arbitrary text (#17).
const FORCE_ESCAPE_RESTORE_CHAR_CLASS = '*_`\\[\\]#\\\\';

/**
 * Convert any `{type: 'text', data: {_forceEscape: true}}` node (produced by
 * `splitEscapedPunctuation` in `parse.ts` and carried through Lexical via the
 * `--md-force-escape` style hint) into a dedicated `escapedChar` node, so its
 * default `toMarkdown` handler can emit a backslash-free placeholder instead
 * of running through the normal text-escaping logic that the two blind-strip
 * post-processes below (intraword underscore, bracket preservation) operate
 * on (#17).
 */
function convertForceEscapeTextNodes(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.children && Array.isArray(node.children)) {
    const children: any[] = [];
    for (const child of node.children) {
      if (child?.type === 'text' && child.data?._forceEscape === true) {
        // Lexical's own reconciliation merges adjacent TextNodes that share
        // identical format/style (see mdastToLexical.ts's setForceEscape),
        // so two force-escaped characters that were adjacent in the source
        // (e.g. "\*\*") can arrive here fused into one multi-character node.
        // Only single-character force-escaped nodes are ever produced
        // upstream, so every character of a fused node was independently
        // force-escaped — expand back into one escapedChar node per
        // character rather than assuming the node is already length 1.
        //
        // An annotate-serialize sentinel token (see annotate-sentinels.ts)
        // can also be spliced onto this exact node's text by
        // `sentinelAugmentedText` in lexicalToMdast.ts before this data is
        // read, so the value isn't always pure escaped content — split those
        // parts out first and leave them as plain, unescaped text (#970).
        for (const part of splitOnSentinelTokens(child.value as string)) {
          if (part.isSentinel) {
            children.push({ type: 'text', value: part.text });
            continue;
          }
          for (const ch of part.text) {
            children.push({ type: 'escapedChar', value: ch });
          }
        }
      } else {
        children.push(convertForceEscapeTextNodes(child));
      }
    }
    return { ...node, children };
  }

  return node;
}

/**
 * Normalize wiki-link nodes for stringification
 *
 * mdast-util-wiki-link expects `data` to exist and reads `data.alias` directly.
 * We keep `data` as an object to avoid runtime errors.
 *
 * We keep data as an object if present, but do not force alias state here.
 */
function normalizeWikiLinkNodes(node: any): any {
  if (!node || typeof node !== 'object') {
    return node;
  }
  
  if (node.type === 'wikiLink') {
    const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};
    return {
      ...node,
      data,
    };
  }
  
  // Recursively normalize children
  if (node.children && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(normalizeWikiLinkNodes),
    };
  }
  
  return node;
}

/**
 * Widen every GFM table delimiter-row cell mdast-util-to-markdown emits at
 * its library-enforced minimum (a bare `-`, or `:-`, `-:`, `:-:` with
 * alignment colons) up to the conventional three-hyphen form GFM,
 * remark-stringify, and Prettier all produce (`---`, `:---`, `---:`,
 * `:---:`). `tablePipeAlign: false` (see the gfmToMarkdown() call below) is
 * the one option controlling both column-width padding and this dash-count
 * minimum in markdown-table — there is no way to keep the former's "no
 * cell-width padding" behavior while asking for the latter's wider default
 * separately, so this text-level post-process patches it after the fact
 * (#60). Only the exact single-dash form the library deterministically
 * emits is matched, so an already-conventional line (3+ dashes) never
 * matches and is left untouched — idempotence for free, with no extra
 * bookkeeping needed. Skips fenced code blocks, inline code spans, and math
 * regions, mirroring the intraword-underscore post-process below, so a
 * fenced block that happens to contain a line shaped like a delimiter row
 * is not rewritten.
 */
function widenTableDelimiterDashes(markdown: string): string {
  return markdown.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$|(`+)[^\n]*?\2|\$\$[\s\S]*?\$\$|\$[^\n$]*?\$|^([ \t]*\|(?:\s*:?-:?\s*\|)+[ \t]*)$/gmu,
    (match, _fenceRun, _inlineOpen, delimiterRow) =>
      delimiterRow === undefined ? match : delimiterRow.replace(/-/g, '---')
  );
}

export function stringifyMarkdown(root: Root, options: StringifyOptions = {}): string {
  // Pre-process: add checkbox text to ordered list items (GFM only outputs for unordered)
  let processedRoot = addCheckboxTextToOrderedLists(root);

  // Normalize wiki-link nodes before stringifying
  processedRoot = normalizeWikiLinkNodes(processedRoot) as Root;

  // Pre-process: isolate force-escaped characters into their own node type
  // so the existing blind-strip post-processes below never see them (#17)
  processedRoot = convertForceEscapeTextNodes(processedRoot) as Root;

  // Compute real spread values for lists/list items (loose vs. tight)
  processedRoot = computeListSpread(processedRoot) as Root;

  let result = toMarkdown(processedRoot, {
    extensions: [
      gfmToMarkdown({
        // Keep a single space padding around cell content, but don't align columns.
        // This preserves the common "| a | b |" style without spacing churn.
        tableCellPadding: true,
        tablePipeAlign: false,
      }),
      mathToMarkdown(),
      defListToMarkdown,
      gfmFootnoteToMarkdown(),
      frontmatterToMarkdown(['yaml']),
      {
        // Custom handlers for emphasis markers and wiki links
        // Cast to allow custom wikiLink handler (not in base Handlers type)
        handlers: {
          emphasis: (node: any, _parent: any, state: any) => {
            const marker = node?.data?._emphasisMarker === '_' ? '_' : '*';
            const content = state.containerPhrasing(node, { before: marker, after: marker });
            return marker + content + marker;
          },
          strong: (node: any, _parent: any, state: any) => {
            const markerChar = node?.data?._strongMarker === '_' ? '_' : '*';
            const marker = markerChar + markerChar;
            const content = state.containerPhrasing(node, { before: marker, after: marker });
            return marker + content + marker;
          },
          escapedChar: (node: any) => `${FORCE_ESCAPE_PLACEHOLDER}${node.value}${FORCE_ESCAPE_PLACEHOLDER}`,
          wikiLink: (node: any) => {
            const value = node.value ?? '';
            const data = node.data && typeof node.data === 'object' ? node.data : {};
            const alias = typeof data.alias === 'string' ? data.alias : '';
            const hasAlias = alias.length > 0 && alias !== value;
            const emptyAlias = data._emptyAlias === true;
            const aliasPart = hasAlias ? `${wikiLinkOptions.aliasDivider}${alias}` : emptyAlias ? `${wikiLinkOptions.aliasDivider}` : '';
            return `[[${value}${aliasPart}]]`;
          },
          // Override mdast-util-definition-list's default (`:` + 3 spaces, i.e. a
          // 4-char marker matching a 4-space continuation indent) with the
          // single-space `: ` marker convention used throughout PHP Markdown
          // Extra source and this codebase's own fixtures/spec examples, so a
          // `: Definition` input round-trips byte-identical instead of being
          // reformatted to `:   Definition`.
          defListDescription: (node: any, _parent: any, state: any, info: any) => {
            const exit = state.enter('defListDescription');
            const value = state.indentLines(
              state.containerFlow(node, info),
              (line: string, index: number, blank: boolean) => {
                if (index) {
                  return blank ? '' : '  ' + line;
                }
                return blank ? ':' : ': ' + line;
              },
            );
            exit();
            return value;
          },
        } as Record<string, unknown>,
      },
    ],
    bullet: options.bulletStyle || '-',
    fence: options.fenceStyle || '`',
    listItemIndent: 'one',
    rule: '-',
    // Custom join function to prevent extra blank lines
    join: [
      // Don't add blank line between paragraph and block when paragraph ends with ':'
      // This preserves the "label + block" pattern (e.g., "Fenced code:", "Block math:").
      // Excludes 'list': unlike table/code/math, a list following a colon-ending
      // paragraph must still get the standard one-blank-line separation every other
      // preceding-block type already gets before a list (see #943) — the zero-blank
      // convention here is specific to the "label:" + verbatim/tabular block pattern.
      // Doesn't apply inside a list item: a table/code fence there needs blank-line
      // separation from the preceding paragraph to parse back correctly, regardless
      // of how that paragraph ends.
      // The colon test reads the sentinel-*free* text: in annotated-serialize
      // mode (see `annotate-sentinels.ts`) the paragraph's last value can carry
      // a trailing close token, so matching the raw value made the paragraph
      // stop "ending with a colon" and re-inserted the blank line before the
      // fence — annotate mode changing output outside its own tokens, which is
      // exactly what `locateLiveMarkdownRange`'s offset math forbids (#970).
      (left: any, right: any, parent: any) => {
        if (left.type === 'paragraph' && parent?.type !== 'listItem') {
          const lastChild = left.children?.[left.children.length - 1];
          const endsWithColon =
            lastChild?.type === 'text' && stripAnnotateSentinels(lastChild.value ?? '').trimEnd().endsWith(':');
          if (endsWithColon && ['table', 'code', 'math'].includes(right.type)) {
            return 0; // No blank line
          }
        }
        return undefined; // Use default
      },
    ],
  });

  // Post-process: widen table delimiter-row dashes to the conventional
  // three-hyphen width (#60). Must run first, before any of the other
  // backslash-stripping/restoring post-processes below, since none of them
  // touch dashes and this step's own verbatim-region skip logic is simplest
  // to reason about against toMarkdown()'s raw output.
  result = widenTableDelimiterDashes(result);

  // Post-process: convert escaped spaces back to regular spaces
  // mdast-util-to-markdown escapes leading/trailing spaces at paragraph
  // boundaries as &#x20; which looks ugly in raw markdown
  result = result.replace(/&#x20;/g, ' ');

  // Post-process: prefer two-space hard breaks over backslash hard breaks
  // Convert a trailing backslash at end of line to two spaces.
  result = result.replace(/\\\n/g, '  \n');

  // Post-process: unescape callout markers in blockquotes
  // Convert "> \[!NOTE]" -> "> [!NOTE]"
  result = result.replace(/^> \\\[!([A-Z]+)\]/gm, '> [!$1]');

  // Post-process: unescape ordered task list markers
  // Convert "1. \[ ]" -> "1. [ ]"
  result = result.replace(/^(\s*\d+\.\s*)\\\[( |x|X)\]/gm, '$1[$2]');

  // Post-process: unescape wiki-link brackets that were escaped
  // mdast-util-to-markdown escapes [ to \[ to prevent link interpretation
  // Pattern: \[\[content]] or \[\[content\]\] → [[content]]
  // NOTE: must run before the bracket preservation step below
  result = result.replace(/\\\[\\\[([^\]\n]+?)\\\]\\\]/g, '[[$1]]');
  result = result.replace(/\\\[\\\[([^\]\n]+?)\]\]/g, '[[$1]]');

  // Post-process: unescape balanced bracket pairs inside image alt text
  // mdast-util-to-markdown always escapes both '[' and ']' within an image's
  // alt-text label (unlike plain phrasing, where only '[' is unsafe), so a
  // literal bracket pair like "see [note] here" serializes as
  // "see \[note\] here" regardless of whether the source was already escaped
  // (the AST only stores the plain alt string; escaped and unescaped sources
  // are indistinguishable once parsed). The bracket-preservation regex below
  // was written for the plain-phrasing case (escaped opener, bare closer) and
  // mis-fires on this already-fully-escaped span, corrupting it (see #903).
  // Strip the escapes back to literal brackets whenever an image's alt-text
  // span contains a properly nested run of escaped brackets — every ']'
  // closes a preceding '[' and depth returns to 0 by the end of the span. An
  // equal open/close *count* alone isn't sufficient (e.g. "a\]b\[c" has one of
  // each but the ']' closes nothing): unescaping that would leave a bare ']'
  // in the middle of the image label and truncate it early, so any span with
  // an out-of-order or otherwise unbalanced bracket is left untouched and
  // deferred to the existing behavior below. `(?:\\.|[^\]\n])*` consumes
  // escaped characters as a unit so an escaped closing bracket in the alt text
  // isn't confused with the image label's own (unescaped) terminating ']'.
  result = result.replace(/!\[((?:\\.|[^\]\n])*)\]\(/g, (match, alt) => {
    if (!/\\[[\]]/.test(alt)) {
      return match;
    }
    const unescaped = alt.replace(/\\([[\]])/g, '$1');
    let depth = 0;
    for (const ch of unescaped) {
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth < 0) {
          return match;
        }
      }
    }
    if (depth !== 0) {
      return match;
    }
    return `![${unescaped}](`;
  });

  // Post-process: strip mdast-util-to-markdown's conservative '[' escape in
  // plain phrasing. mdast-util-to-markdown always escapes a literal '[' in
  // phrasing content (in case a same-named link reference definition exists
  // elsewhere in the document) but leaves a lone ']' bare, since ']' is only
  // ever unsafe inside an actual link/image label — and label content is
  // always escaped in full by the link/image handlers themselves (see #918
  // research: no code path produces a half-escaped label). So an escaped '\['
  // followed eventually by a bare ']' can only originate from genuine
  // top-level phrasing, never from an under-escaped label, and the '[' escape
  // there is unnecessary: strip it rather than "completing" it by escaping
  // the ']' too (which corrupted plain prose brackets, see #918).
  // Image alt-text spans are excluded (tried first, left untouched) so this
  // doesn't undo the deliberate escape-preservation of the block above, which
  // already resolved (or intentionally preserved) unbalanced/pre-escaped
  // bracket content inside `![...](`.
  // Accepted trade-off: if the document also has a reference-link definition
  // matching this bracket text elsewhere (e.g. `[label]: url`), stripping the
  // escape means the round-tripped prose will now parse as a real reference
  // link instead of staying inert — a semantic change. This mirrors
  // mdast-util-to-markdown's own conservative-by-default behavior and is out
  // of scope for this fix (see #918 "Out of Scope").
  // Known limitation: unlike the underscore step below, this (and the #903
  // block above it) operate on the fully serialized string without excluding
  // fenced/inline code or math spans, so literal `\[...]` text inside one of
  // those verbatim regions would also be stripped. Pre-existing gap (not
  // introduced by this fix); out of scope per #918 "Out of Scope" (brackets
  // inside code spans).
  result = result.replace(
    /!\[(?:\\.|[^\\\]\n])*\]\(|\\\[([^\]\n]+)\](?!\])/g,
    (match, plainPhrasingContent) => (plainPhrasingContent === undefined ? match : `[${plainPhrasingContent}]`)
  );

  // Post-process: unescape intraword underscores, outside of code and math.
  // mdast-util-to-markdown escapes every `_` in text conservatively, but CommonMark
  // never lets an intraword underscore (flanked by alphanumerics on both sides) open
  // or close emphasis — so escaping it is unnecessary. An underscore adjacent to
  // whitespace/punctuation (e.g. `_word_`) can still form emphasis and must stay escaped.
  // Code (fenced blocks and inline spans) and math ($...$ / $$...$$) are skipped: their
  // content is emitted verbatim, so a literal `\_` there (e.g. a regex/shell escape, or
  // a LaTeX subscript marker) is the user's own text and must not be rewritten. The fenced
  // code alternative backreferences the opening fence run so a closing line using a
  // different fence character/length (or a same-character run that's just code content)
  // doesn't end the protected region early.
  result = result.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$|(`+)[^\n]*?\2|\$\$[\s\S]*?\$\$|\$[^\n$]*?\$|((?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}]))/gmu,
    (match, _fenceRun, _inlineOpen, underscore) => (underscore === undefined ? match : '_')
  );

  // Post-process: restore the real backslash for every force-escaped
  // character (#17), now that every other post-process above — which only
  // ever strips backslashes, never adds them — has already run and had no
  // chance to see (or strip) a backslash that wasn't there yet.
  result = result.replace(
    new RegExp(`${FORCE_ESCAPE_PLACEHOLDER}([${FORCE_ESCAPE_RESTORE_CHAR_CLASS}])${FORCE_ESCAPE_PLACEHOLDER}`, 'gu'),
    '\\$1'
  );

  return result;
}

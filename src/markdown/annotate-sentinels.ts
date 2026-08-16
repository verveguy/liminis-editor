/**
 * The Unicode Private-Use-Area sentinel tokens annotated-serialize mode
 * brackets a live annotation mark's content with, plus the one helper that
 * removes them again.
 *
 * They live here — below both the mapper and the stringifier — because the
 * *invariant* they exist to serve reaches into both. Annotate mode must differ
 * from a plain export by the tokens and nothing else (see
 * `lexicalToMdast.ts`'s annotated-serialize header): the whole recovered-range
 * calculation in `annotation-marks.ts` is offset arithmetic against a plain
 * export of the same state. So every *decision* either module makes from a
 * piece of text — "does this list item already carry an explicit `[ ]`
 * marker?", "does this paragraph end in a colon?" — has to be made against the
 * sentinel-free form, or enabling annotate mode changes output somewhere the
 * caller never looks (Liminis #970).
 */

export const SENTINEL_OPEN_START = '\u{E000}';
export const SENTINEL_OPEN_END = '\u{E001}';
export const SENTINEL_CLOSE_START = '\u{E002}';
export const SENTINEL_CLOSE_END = '\u{E003}';

/**
 * Matches one whole sentinel token — an open pair or a close pair, with an
 * annotation id between them.
 *
 * Two things keep this from eating real content, and both are load-bearing:
 *
 * 1. **The id is a negated character class** excluding all four delimiters, so
 *    the run cannot cross a delimiter and the match is forced to end at the
 *    first one it meets. Greediness is irrelevant for that reason — do not
 *    "simplify" this to `.*?`. A lazy dot matches delimiters happily, so on
 *    `…␀b␀id␁…` it would span from the *stray* opener to the first closer and
 *    delete the real text `b` along with the token.
 * 2. **Each alternative pairs its own delimiters** — open-with-open,
 *    close-with-close. Choosing the two ends from independent classes would
 *    also match an open *paired with a close*, which the emitters never
 *    produce (see `openToken`/`closeToken` in `lexicalToMdast.ts`); on
 *    `…␀real text␃…` that mismatched span would be deleted, taking the real
 *    text with it. Only well-formed tokens should ever be removed, because
 *    this function feeds *decisions* — the explicit task-marker test and the
 *    ends-with-a-colon join rule — where a wrong strip silently changes
 *    output.
 */
const SENTINEL_ID_RUN = `[^${SENTINEL_OPEN_START}${SENTINEL_OPEN_END}${SENTINEL_CLOSE_START}${SENTINEL_CLOSE_END}]*`;
const SENTINEL_TOKEN =
  new RegExp(
    `${SENTINEL_OPEN_START}${SENTINEL_ID_RUN}${SENTINEL_OPEN_END}` +
      `|${SENTINEL_CLOSE_START}${SENTINEL_ID_RUN}${SENTINEL_CLOSE_END}`,
    'gu',
  );

/**
 * `text` with every annotate-mode sentinel token removed. A no-op — and cheap
 * — for the overwhelmingly common case of a string that contains none, which
 * is every string on the disk-write path.
 */
export function stripAnnotateSentinels(text: string): string {
  if (!text.includes(SENTINEL_OPEN_START) && !text.includes(SENTINEL_CLOSE_START)) return text;
  return text.replace(SENTINEL_TOKEN, '');
}

export interface SentinelSplitPart {
  text: string;
  isSentinel: boolean;
}

/**
 * Split `text` into alternating sentinel-token and plain-text parts.
 *
 * Used by `stringify.ts`'s force-escape handling (#17): a force-escaped
 * text node's `getTextContent()` can have a sentinel token spliced onto
 * either end by `sentinelAugmentedText` (annotate-serialize mode, see the
 * module doc comment above) before the force-escape data is read, so
 * treating the whole string as "one force-escaped run" would wrap the
 * token's own characters in escape placeholders too. Splitting first lets
 * the caller escape only the real content and leave token parts verbatim.
 */
export function splitOnSentinelTokens(text: string): SentinelSplitPart[] {
  if (!text.includes(SENTINEL_OPEN_START) && !text.includes(SENTINEL_CLOSE_START)) {
    return [{ text, isSentinel: false }];
  }

  const parts: SentinelSplitPart[] = [];
  let cursor = 0;
  SENTINEL_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTINEL_TOKEN.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), isSentinel: false });
    }
    parts.push({ text: match[0], isSentinel: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), isSentinel: false });
  }
  return parts;
}

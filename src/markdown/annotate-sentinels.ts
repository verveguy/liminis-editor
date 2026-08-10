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
 * Matches one whole sentinel token — an open or close delimiter pair with an
 * annotation id between them.
 *
 * The id is matched by a *negated character class* excluding all four
 * delimiters, which is what stops a stray unpaired delimiter in real content
 * from swallowing the text after it: the run cannot cross a delimiter, so the
 * match is forced to end at the first one it meets. Greediness is irrelevant
 * here for that reason — do not "simplify" this to `.*?`. A lazy dot matches
 * delimiters happily, so on `…␀b␀id␁…` it would span from the *stray* opener
 * to the first closer and delete the real text `b` along with the token.
 */
const SENTINEL_TOKEN =
  new RegExp(
    `[${SENTINEL_OPEN_START}${SENTINEL_CLOSE_START}]` +
      `[^${SENTINEL_OPEN_START}${SENTINEL_OPEN_END}${SENTINEL_CLOSE_START}${SENTINEL_CLOSE_END}]*` +
      `[${SENTINEL_OPEN_END}${SENTINEL_CLOSE_END}]`,
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

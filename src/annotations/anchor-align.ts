/**
 * PROVENANCE — ported from Zusammen (`verveguy/zusammen`) for Liminis #939.
 *
 * The doc comments below are the original author's and are kept verbatim so
 * this module stays diffable against its source. Their `FR-NNN`/`SC-NNN`
 * identifiers, `#NN` issue references and `adrs/` paths therefore name
 * **Zusammen's** spec, issues and ADRs — not this repository's, where the same
 * identifiers mean something else entirely. For the Liminis-side design see
 * `docs/decisions/adr-077.md` and
 * `docs/zusammen-editor-capability-map.md`.
 *
 * "Comment"/"thread" in these comments should be read as "annotation": this
 * module now serves both annotation kinds, not comments alone.
 */
/**
 * Comment Anchor Alignment
 *
 * `locateInSpan`: the verbatim-substring, context/occurrence-disambiguated
 * text search shared by both directions of the comment-anchor mapping
 * (capture and marker placement) — reused unchanged by #43's live-mark
 * mechanism (`editor/app/editor/comment-anchor-marks.ts`) for the same
 * lookup it always did: `targetText` -> location within the current raw
 * markdown. Pure, git-free — no fs, no git, no DOM — safe to unit test with
 * plain data.
 */

import { similarity } from './anchor-resolver'

export interface SpanRange {
  start: number
  end: number
}

export interface LocateInSpanOptions {
  /** 0-based index of which occurrence of `target` to prefer, when known. */
  occurrenceIndex?: number
  /** Text immediately before the target, for disambiguating duplicate occurrences. */
  prefixContext?: string
  /** Text immediately after the target, for disambiguating duplicate occurrences. */
  suffixContext?: string
}

/** How many characters of context around a candidate occurrence to compare against `prefixContext`/`suffixContext`. */
const CONTEXT_COMPARISON_CHARS = 40

function findOccurrences(spanText: string, target: string): SpanRange[] {
  if (!target) return []
  const matches: SpanRange[] = []
  let idx = spanText.indexOf(target)
  while (idx !== -1) {
    matches.push({ start: idx, end: idx + target.length })
    idx = spanText.indexOf(target, idx + 1)
  }
  return matches
}

/**
 * Locate `target` verbatim within `spanText`. Returns null if `target` does
 * not appear at all — the caller falls back to anchoring the whole enclosing
 * block (the Plan's bounded v1 scope for selections that straddle inline
 * markdown syntax, e.g. a selection starting mid-`**bold**`).
 *
 * When `target` appears more than once, candidates are ranked by how well
 * their surrounding context matches `prefixContext`/`suffixContext` plus
 * proximity to `occurrenceIndex` — the same disambiguation signal
 * `anchor-resolver.ts` uses for duplicate exact matches, reused here (via the
 * shared `similarity` export) rather than reinvented.
 */
export function locateInSpan(spanText: string, target: string, options: LocateInSpanOptions = {}): SpanRange | null {
  const matches = findOccurrences(spanText, target)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]

  const { occurrenceIndex, prefixContext = '', suffixContext = '' } = options
  // Only weigh in context when the caller actually supplied any — comparing
  // against an empty context would otherwise favor whichever occurrence
  // happens to have the shortest surrounding text, not the intended one.
  const hasContext = prefixContext.length > 0 || suffixContext.length > 0
  const contextWeight = hasContext ? 0.8 : 0
  const proximityWeight = 1 - contextWeight
  const scored = matches.map((match, index) => {
    const prefix = spanText.slice(Math.max(0, match.start - CONTEXT_COMPARISON_CHARS), match.start)
    const suffix = spanText.slice(match.end, Math.min(spanText.length, match.end + CONTEXT_COMPARISON_CHARS))
    const contextScore = (similarity(prefix, prefixContext) + similarity(suffix, suffixContext)) / 2
    const proximityScore = occurrenceIndex == null ? 0 : 1 - Math.abs(index - occurrenceIndex) / matches.length
    return { match, score: contextScore * contextWeight + proximityScore * proximityWeight }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].match
}

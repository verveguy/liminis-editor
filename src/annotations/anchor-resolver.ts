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
 * Comment Anchor Resolver
 *
 * The deterministic classification algorithm at the heart of durable comment
 * anchoring (issue #25): given an anchor captured against some prior document
 * version and the text of a new version, decide whether the comment's target
 * is unchanged, should be re-attached, must be flagged, or is orphaned
 * (FR-002). Needs only the anchor plus the new text — never the old text —
 * which is what makes resolution provenance-agnostic (FR-010): a direct edit
 * and a merge that produce the same new text resolve identically.
 *
 * Pure, git-free — no fs, no git, safe to unit test with plain strings.
 */

import type { Anchor, AnchorResolution } from './anchor-model'
import { captureAnchor, CONTEXT_WINDOW_CHARS } from './anchor-model'
import { type Block, findEnclosingBlock, parseBlocks, sentenceChunks } from './block-structure'

// ============================================================================
// Thresholds
// ============================================================================

/**
 * Minimum normalized similarity for a fuzzy match to re-attach automatically.
 * Chosen so a "single-digit percentage of characters changed" reword (SC-002)
 * clears this floor comfortably (e.g. changing 2 words out of 10 in a short
 * sentence typically scores well above 0.6), while a heavily rewritten or
 * unrelated target does not. Not corpus-calibrated — a reasoned default,
 * revisable via this one constant.
 */
export const REATTACH_THRESHOLD = 0.6

/**
 * Minimum normalized similarity for a fuzzy match to flag rather than orphan
 * outright. Below this floor there is essentially no lexical overlap left
 * (SC-004's deleted-target case, and US2 acceptance scenario 3's heavy
 * rewrite), so the target is treated as gone rather than merely uncertain.
 */
export const FLAG_THRESHOLD = 0.35

/**
 * Minimum score gap between the best and second-best candidate occurrence of
 * duplicate target text before the resolver will pick one automatically
 * (FR-006). Below this margin, picking either risks silently relocating onto
 * the wrong occurrence (SC-003) — flagged instead.
 */
const AMBIGUITY_MARGIN = 0.15

// ============================================================================
// Relocation seam
// ============================================================================

/**
 * Optional extension point consulted only for an otherwise-orphaned comment
 * (FR-008). Returns a freshly captured anchor if a relocation is proposed, or
 * null to fall through to orphaned. This issue ships only the no-op default —
 * a model-backed implementation is a separate follow-on (see adrs/ for the
 * anchor-resolution ADR and the design context on this issue).
 */
export type ProposeSemanticRelocation = (params: { anchor: Anchor; newText: string }) => Promise<Anchor | null> | Anchor | null

export const noopProposeSemanticRelocation: ProposeSemanticRelocation = () => null

// ============================================================================
// Similarity
// ============================================================================

/** Levenshtein edit distance, O(n*m) time and O(min(n,m)) space. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Iterate over the shorter string as columns to bound space by min(n, m).
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  let prevRow = Array.from({ length: shorter.length + 1 }, (_, i) => i)

  for (let i = 1; i <= longer.length; i++) {
    const currRow = [i]
    for (let j = 1; j <= shorter.length; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      )
    }
    prevRow = currRow
  }

  return prevRow[shorter.length]
}

/** Normalized similarity in [0, 1] — 1 means identical, 0 means completely dissimilar. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1)
  return 1 - levenshteinDistance(a, b) / maxLen
}

// ============================================================================
// Exact-match search
// ============================================================================

interface TextRange {
  start: number
  end: number
}

function findExactOccurrences(text: string, targetText: string): TextRange[] {
  if (!targetText) return []
  const matches: TextRange[] = []
  let idx = text.indexOf(targetText)
  while (idx !== -1) {
    matches.push({ start: idx, end: idx + targetText.length })
    idx = text.indexOf(targetText, idx + 1)
  }
  return matches
}

/**
 * Rank exact occurrences of the target text by how well their surrounding
 * context matches the anchor's recorded context, plus proximity to the
 * anchor's recorded occurrence index (FR-006). Returns the best candidate and
 * whether it's confident enough to pick automatically.
 */
function rankDuplicateOccurrences(
  newText: string,
  anchor: Anchor,
  matches: TextRange[],
): { best: TextRange; confident: boolean } {
  const scored = matches.map((match, index) => {
    const prefix = newText.slice(Math.max(0, match.start - CONTEXT_WINDOW_CHARS), match.start)
    const suffix = newText.slice(match.end, Math.min(newText.length, match.end + CONTEXT_WINDOW_CHARS))
    const contextScore = (similarity(prefix, anchor.prefixContext) + similarity(suffix, anchor.suffixContext)) / 2
    const proximityScore = 1 - Math.abs(index - anchor.occurrenceIndex) / matches.length
    return { match, score: contextScore * 0.8 + proximityScore * 0.2 }
  })
  scored.sort((a, b) => b.score - a.score)

  const [best, second] = scored
  const confident = !second || best.score - second.score > AMBIGUITY_MARGIN
  return { best: best.match, confident }
}

// ============================================================================
// Fuzzy search
// ============================================================================

interface FuzzyCandidate extends TextRange {
  text: string
  score: number
}

function scoreCandidate(candidateText: string, range: TextRange, targetText: string): FuzzyCandidate {
  return { ...range, text: candidateText, score: similarity(candidateText, targetText) }
}

function bestOf(candidates: FuzzyCandidate[]): FuzzyCandidate | undefined {
  return candidates.reduce<FuzzyCandidate | undefined>(
    (best, candidate) => (!best || candidate.score > best.score ? candidate : best),
    undefined,
  )
}

/**
 * Search for the best fuzzy match to the anchor's target text, considering
 * each block's full text and each sentence-chunk within it as a single-block
 * candidate, plus each pair of adjacent blocks' concatenated text as a
 * multi-block candidate (used only to detect a range split — FR-007, US2
 * acceptance scenario 4). If the best-scoring candidate overall only clears
 * the re-attach floor by spanning two blocks, that's reported so the caller
 * flags instead of silently re-attaching to a partial range.
 */
function findBestFuzzyMatch(
  newText: string,
  anchor: Anchor,
  blocks: readonly Block[],
): { best: FuzzyCandidate | undefined; spansMultipleBlocks: boolean } {
  const singleBlockCandidates: FuzzyCandidate[] = []

  for (const block of blocks) {
    const blockText = newText.slice(block.start, block.end)
    singleBlockCandidates.push(scoreCandidate(blockText, block, anchor.targetText))
    for (const chunk of sentenceChunks(blockText)) {
      const range = { start: block.start + chunk.start, end: block.start + chunk.end }
      singleBlockCandidates.push(scoreCandidate(chunk.text, range, anchor.targetText))
    }
  }

  // Concatenate each nearby pair of blocks' *own* text — skipping up to one
  // block in between (e.g. a newly inserted heading) — so a target that split
  // across a new structural boundary still reconstructs at high similarity.
  // Without this, whichever half happens to score highest alone could clear
  // REATTACH_THRESHOLD on its own and silently re-attach to a partial range.
  const multiBlockCandidates: FuzzyCandidate[] = []
  for (let i = 0; i < blocks.length; i++) {
    for (const offset of [1, 2]) {
      const j = i + offset
      if (j >= blocks.length) continue
      const a = blocks[i]
      const b = blocks[j]
      const combinedText = newText.slice(a.start, a.end) + newText.slice(b.start, b.end)
      const range = { start: a.start, end: b.end }
      multiBlockCandidates.push(scoreCandidate(combinedText, range, anchor.targetText))
    }
  }

  const bestSingle = bestOf(singleBlockCandidates)
  const bestMulti = bestOf(multiBlockCandidates)

  if (bestMulti && bestMulti.score >= REATTACH_THRESHOLD && (!bestSingle || bestMulti.score > bestSingle.score)) {
    return { best: bestMulti, spansMultipleBlocks: true }
  }
  return { best: bestSingle, spansMultipleBlocks: false }
}

// ============================================================================
// Resolution
// ============================================================================

export interface ResolveAnchorOptions {
  proposeSemanticRelocation?: ProposeSemanticRelocation
}

function sameBlockType(block: Block | undefined, anchorBlockType: Anchor['blockType']): boolean {
  return (block?.type ?? null) === anchorBlockType
}

/**
 * Resolve a comment's anchor against a new document version (FR-002). Never
 * needs the old document text — only the anchor and `newText` — so a direct
 * edit and a merge that land on the same new text resolve identically
 * (FR-010).
 */
export async function resolveAnchor(
  anchor: Anchor,
  newText: string,
  newDocVersion: string,
  options: ResolveAnchorOptions = {},
): Promise<AnchorResolution> {
  const blocks = parseBlocks(newText)
  const exactMatches = findExactOccurrences(newText, anchor.targetText)

  if (exactMatches.length > 0) {
    const { best, confident } =
      exactMatches.length === 1
        ? { best: exactMatches[0], confident: true }
        : rankDuplicateOccurrences(newText, anchor, exactMatches)

    if (!confident) {
      return { outcome: 'flagged', docVersion: newDocVersion, reason: 'ambiguous duplicate occurrence' }
    }

    const enclosing = findEnclosingBlock(blocks, best.start, best.end)
    if (sameBlockType(enclosing, anchor.blockType)) {
      return { outcome: 'unchanged', docVersion: newDocVersion, reason: 'exact match, same block type' }
    }
    return { outcome: 'flagged', docVersion: newDocVersion, reason: 'exact match crossed a structural boundary' }
  }

  const { best, spansMultipleBlocks } = findBestFuzzyMatch(newText, anchor, blocks)

  if (best && spansMultipleBlocks) {
    return { outcome: 'flagged', docVersion: newDocVersion, reason: 'best match only clears the bar by spanning a structural boundary (range split)' }
  }

  if (best && best.score >= REATTACH_THRESHOLD) {
    const newAnchor = captureAnchor(newText, { start: best.start, end: best.end }, newDocVersion)
    return { outcome: 're-attached', docVersion: newDocVersion, reason: `fuzzy match (similarity ${best.score.toFixed(2)})`, anchor: newAnchor }
  }

  if (best && best.score >= FLAG_THRESHOLD) {
    return { outcome: 'flagged', docVersion: newDocVersion, reason: `low-confidence match (similarity ${best.score.toFixed(2)})` }
  }

  const propose = options.proposeSemanticRelocation ?? noopProposeSemanticRelocation
  const proposed = await propose({ anchor, newText })
  if (proposed) {
    return { outcome: 're-attached', docVersion: newDocVersion, reason: 'semantic relocation proposed', anchor: proposed }
  }
  return { outcome: 'orphaned', docVersion: newDocVersion, reason: 'no recognizable match; relocation seam declined' }
}

// ============================================================================
// Batch resolution (package public surface)
// ============================================================================

/** An anchor paired with the caller's opaque identifier for it. */
export interface IdentifiedAnchor {
  id: string
  anchor: Anchor
}

/** One batch entry's outcome, carrying back the caller's `id` unchanged. */
export interface AnchorResolutionResult {
  id: string
  outcome: AnchorResolution['outcome']
  reason: string
  /** Present only when the outcome is `re-attached`. */
  resolvedAnchor?: Anchor
}

/**
 * Resolve many anchors against one document version — the headless entry point
 * hosts call outside a rendered editor (FR-002). Each anchor resolves through
 * the same {@link resolveAnchor} path, so classification is identical to the
 * single-anchor case; this wrapper only handles fan-out and re-attaches the
 * caller's opaque `id` to each outcome.
 *
 * With no `proposeSemanticRelocation` supplied, an unmatchable anchor yields
 * `orphaned` rather than throwing (US3 acceptance scenario 3).
 */
export async function resolveAnchors(
  anchors: readonly IdentifiedAnchor[],
  documentText: string,
  documentVersion: string,
  options: ResolveAnchorOptions = {},
): Promise<AnchorResolutionResult[]> {
  return Promise.all(
    anchors.map(async ({ id, anchor }) => {
      const resolution = await resolveAnchor(anchor, documentText, documentVersion, options)
      return {
        id,
        outcome: resolution.outcome,
        reason: resolution.reason,
        ...(resolution.anchor ? { resolvedAnchor: resolution.anchor } : {}),
      }
    }),
  )
}

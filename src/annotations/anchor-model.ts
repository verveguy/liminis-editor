/**
 * PROVENANCE — ported from Zusammen (`verveguy/zusammen`) for Liminis #939.
 *
 * The doc comments below are the original author's and are kept verbatim so
 * this module stays diffable against its source. Their `FR-NNN`/`SC-NNN`
 * identifiers, `#NN` issue references and `adrs/` paths therefore name
 * **Zusammen's** spec, issues and ADRs — not this repository's, where the same
 * identifiers mean something else entirely. For the Liminis-side design see
 * `docs/project_notes/decisions/adr-077.md` and
 * `docs/project_notes/zusammen-editor-capability-map.md`.
 *
 * "Comment"/"thread" in these comments should be read as "annotation": this
 * module now serves both annotation kinds, not comments alone.
 */
/**
 * Comment Anchor Model
 *
 * Defines the content-relative anchor payload persisted through the
 * comment-event-store's (issue #13) `re-anchor`/`anchor-recorded` events, and
 * the resolution-outcome payload persisted through `anchor-resolved` events.
 * Both were left opaque (`unknown`) by that store on purpose — this module is
 * what gives them shape (FR-001, FR-002).
 *
 * Pure, git-free — no fs, no git, safe to unit test with plain strings.
 */

import { z } from 'zod'
import { findEnclosingBlock, parseBlocks, type BlockType } from './block-structure'

// ============================================================================
// Anchor
// ============================================================================

/** How many characters of surrounding text are captured on each side of the target, for duplicate disambiguation (FR-006). */
export const CONTEXT_WINDOW_CHARS = 40

/**
 * The durable, content-relative description of a comment's target (FR-001).
 * Re-locating a target needs only an anchor plus the new document text — never
 * the old document text — which is what makes resolution provenance-agnostic
 * (FR-010): a direct edit and a merge produce the same new text.
 */
export interface Anchor {
  /** The exact substring the comment targets. */
  targetText: string
  /** Up to CONTEXT_WINDOW_CHARS of text immediately before the target. */
  prefixContext: string
  /** Up to CONTEXT_WINDOW_CHARS of text immediately after the target. */
  suffixContext: string
  /** The type of the single leaf block enclosing the target at capture time, or null if the target itself spans more than one block. */
  blockType: BlockType | null
  /** 0-based index of which occurrence of `targetText` in the document this anchor refers to — disambiguates duplicate text (FR-006). */
  occurrenceIndex: number
  /** The content-repo HEAD SHA the anchor was captured against. */
  docVersion: string
}

/** An anchor as read from the live editor structure, before the store stamps `docVersion`. */
export type AnchorFields = Omit<Anchor, 'docVersion'>

export const ANCHOR_SCHEMA: z.ZodType<Anchor> = z.object({
  targetText: z.string(),
  prefixContext: z.string(),
  suffixContext: z.string(),
  blockType: z.enum(['paragraph', 'heading', 'code', 'tableCell', 'thematicBreak']).nullable(),
  occurrenceIndex: z.number().int().min(0),
  docVersion: z.string().min(1),
})

export interface AnchorRange {
  start: number
  end: number
}

/** Count occurrences of `targetText` in `text` that start strictly before `beforeStart`. */
function occurrenceIndexOf(text: string, targetText: string, beforeStart: number): number {
  if (!targetText) return 0
  let count = 0
  let idx = text.indexOf(targetText)
  while (idx !== -1 && idx < beforeStart) {
    count++
    idx = text.indexOf(targetText, idx + 1)
  }
  return count
}

/**
 * Capture a durable anchor for the text at `range` within `text`, as of
 * `docVersion`. The target's enclosing block type is null when the range
 * spans more than one leaf block (e.g. a comment deliberately covering two
 * paragraphs) — the resolver treats that the same as any other
 * structural-boundary case.
 */
export function captureAnchor(text: string, range: AnchorRange, docVersion: string): Anchor {
  const targetText = text.slice(range.start, range.end)
  const prefixContext = text.slice(Math.max(0, range.start - CONTEXT_WINDOW_CHARS), range.start)
  const suffixContext = text.slice(range.end, Math.min(text.length, range.end + CONTEXT_WINDOW_CHARS))
  const blocks = parseBlocks(text)
  const enclosing = findEnclosingBlock(blocks, range.start, range.end)

  return {
    targetText,
    prefixContext,
    suffixContext,
    blockType: enclosing?.type ?? null,
    occurrenceIndex: occurrenceIndexOf(text, targetText, range.start),
    docVersion,
  }
}

// ============================================================================
// Anchor Resolution
// ============================================================================

export type AnchorOutcome = 'unchanged' | 're-attached' | 'flagged' | 'orphaned'

/**
 * The outcome of re-evaluating a comment's anchor against a new document
 * version (FR-002). Persisted verbatim as the payload of an `anchor-resolved`
 * event; `anchor` is additionally persisted as the payload of the
 * `anchor-recorded` event that accompanies a `re-attached` outcome.
 */
export interface AnchorResolution {
  outcome: AnchorOutcome
  /** The content-repo HEAD SHA this resolution was evaluated against. */
  docVersion: string
  /** Short, human-readable explanation of why this outcome was reached. */
  reason: string
  /** Present only when outcome === 're-attached' — the anchor recomputed at the new location. */
  anchor?: Anchor
}

export const ANCHOR_RESOLUTION_SCHEMA: z.ZodType<AnchorResolution> = z.object({
  outcome: z.enum(['unchanged', 're-attached', 'flagged', 'orphaned']),
  docVersion: z.string().min(1),
  reason: z.string(),
  anchor: ANCHOR_SCHEMA.optional(),
})

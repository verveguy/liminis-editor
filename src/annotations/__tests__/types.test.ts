/**
 * Tests for the unified annotation types (ADR-076).
 *
 * The `shouldPlaceLiveMark` block is carried over from Zusammen's
 * `comment-thread.test.ts` verbatim in substance — the rest of that suite tests
 * `Thread`/`Comment` shapes that are app-domain under ADR-075 and are not
 * ported. `deriveMarkerTargets` here is the package's annotation-based
 * replacement for Zusammen's thread-based one, so its tests are new.
 */
import { describe, expect, it } from 'vitest'
import { captureAnchor } from '../anchor-model'
import {
  deriveMarkerTargets,
  shouldPlaceLiveMark,
  type Annotation,
  type AnnotationKindConfigs,
} from '../types'

const DOC = 'The quick brown fox jumps over the lazy dog.'
const ANCHOR = captureAnchor(DOC, { start: 4, end: 19 }, 'v1')

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return { id: 'a1', kind: 'comment', anchor: ANCHOR, ...overrides }
}

const COMMENT_KIND: AnnotationKindConfigs = {
  comment: { markerStyle: 'highlight', createAffordance: { surface: 'toolbar' }, retainMarkOnCreate: true },
}

describe('shouldPlaceLiveMark (ported from Zusammen comment-thread.test.ts)', () => {
  it('places a live mark for unchanged and re-attached outcomes', () => {
    expect(shouldPlaceLiveMark('unchanged')).toBe(true)
    expect(shouldPlaceLiveMark('re-attached')).toBe(true)
  })

  it('stays panel-only for flagged and orphaned outcomes — never placed on uncertain or missing text', () => {
    expect(shouldPlaceLiveMark('flagged')).toBe(false)
    expect(shouldPlaceLiveMark('orphaned')).toBe(false)
  })
})

describe('deriveMarkerTargets', () => {
  it('defaults a missing outcome to unchanged and places a mark', () => {
    const targets = deriveMarkerTargets([annotation()], COMMENT_KIND)
    expect(targets).toEqual([{ annotationId: 'a1', kind: 'comment', anchor: ANCHOR, outcome: 'unchanged' }])
  })

  it('applies the default live-mark policy per outcome', () => {
    const all: Annotation[] = [
      annotation({ id: 'u', outcome: 'unchanged' }),
      annotation({ id: 'r', outcome: 're-attached' }),
      annotation({ id: 'f', outcome: 'flagged' }),
      annotation({ id: 'o', outcome: 'orphaned' }),
    ]
    expect(deriveMarkerTargets(all, COMMENT_KIND).map((t) => t.annotationId)).toEqual(['u', 'r'])
  })

  it('lets a kind override the policy — the correction kind places nothing', () => {
    const kinds: AnnotationKindConfigs = {
      correction: {
        markerStyle: 'none',
        createAffordance: { surface: 'contextMenu' },
        livemarkPolicy: () => false,
      },
    }
    const targets = deriveMarkerTargets(
      [annotation({ kind: 'correction', outcome: 'unchanged' })],
      kinds,
    )
    expect(targets).toEqual([])
  })

  it('drops annotations whose kind has no configuration rather than throwing', () => {
    const targets = deriveMarkerTargets(
      [annotation({ id: 'known' }), annotation({ id: 'unknown', kind: 'no-such-kind' })],
      COMMENT_KIND,
    )
    expect(targets.map((t) => t.annotationId)).toEqual(['known'])
  })

  it('keeps both kinds when both are configured, tagging each target with its kind', () => {
    const kinds: AnnotationKindConfigs = {
      ...COMMENT_KIND,
      correction: { markerStyle: 'squiggle' },
    }
    const targets = deriveMarkerTargets(
      [annotation({ id: 'c1' }), annotation({ id: 'x1', kind: 'correction' })],
      kinds,
    )
    expect(targets.map((t) => [t.annotationId, t.kind])).toEqual([
      ['c1', 'comment'],
      ['x1', 'correction'],
    ])
  })

  it('derives nothing when no kinds are configured at all (FR-004)', () => {
    expect(deriveMarkerTargets([annotation()], {})).toEqual([])
  })

  // Review finding (CodeRabbit): the marker renderer only ever sees targets, so
  // dropping `presentation` here made AnnotationPresentation's className/label
  // overrides unreachable in practice.
  it("carries the annotation's presentation through to its marker target", () => {
    const presentation = { className: 'my-marker', label: 'Reviewer note' }
    const targets = deriveMarkerTargets([annotation({ presentation })], COMMENT_KIND)

    expect(targets).toHaveLength(1)
    expect(targets[0].presentation).toEqual(presentation)
  })

  it('leaves presentation undefined when the annotation supplies none', () => {
    const targets = deriveMarkerTargets([annotation()], COMMENT_KIND)

    expect(targets[0].presentation).toBeUndefined()
  })
})

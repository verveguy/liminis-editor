/**
 * Tests for the batch `resolveAnchors` wrapper — the headless entry point a
 * host calls outside a rendered editor (FR-002, US3 acceptance scenario 3).
 *
 * The classification behaviour itself is covered by anchor-resolver.test.ts;
 * these tests pin the wrapper's own contract: id pass-through, per-anchor
 * independence, and the absent-relocation-seam case yielding `orphaned`.
 */
import { describe, expect, it, vi } from 'vitest'
import { captureAnchor } from '../anchor-model'
import { resolveAnchors } from '../anchor-resolver'

const DOC = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph entirely.'

describe('resolveAnchors', () => {
  it('returns each caller-supplied id unchanged, in input order', async () => {
    const a = captureAnchor(DOC, { start: 4, end: 19 }, 'v1') // "quick brown fox"
    const b = captureAnchor(DOC, { start: 45, end: 53 }, 'v1') // "A second"

    const results = await resolveAnchors(
      [
        { id: 'anno-b', anchor: b },
        { id: 'anno-a', anchor: a },
      ],
      DOC,
      'v2',
    )

    expect(results.map((r) => r.id)).toEqual(['anno-b', 'anno-a'])
    expect(results.every((r) => r.outcome === 'unchanged')).toBe(true)
  })

  it('yields orphaned rather than throwing when no relocation strategy is supplied', async () => {
    const anchor = captureAnchor(DOC, { start: 4, end: 19 }, 'v1')
    const rewritten = 'Completely unrelated prose about maritime navigation charts.'

    const [result] = await resolveAnchors([{ id: 'anno-1', anchor }], rewritten, 'v2')

    expect(result.outcome).toBe('orphaned')
    expect(result.resolvedAnchor).toBeUndefined()
  })

  it('consults a host-supplied relocation strategy before orphaning', async () => {
    const anchor = captureAnchor(DOC, { start: 4, end: 19 }, 'v1')
    const rewritten = 'Completely unrelated prose about maritime navigation charts.'
    const relocated = captureAnchor(rewritten, { start: 0, end: 12 }, 'v2')
    const propose = vi.fn().mockResolvedValue(relocated)

    const [result] = await resolveAnchors([{ id: 'anno-1', anchor }], rewritten, 'v2', {
      proposeSemanticRelocation: propose,
    })

    expect(propose).toHaveBeenCalledOnce()
    expect(result.outcome).toBe('re-attached')
    expect(result.resolvedAnchor).toEqual(relocated)
  })

  it('carries resolvedAnchor only for re-attached outcomes', async () => {
    // Anchor the whole first sentence, so a one-word reword actually displaces
    // the target text rather than leaving it an exact substring.
    const anchor = captureAnchor(DOC, { start: 0, end: 43 }, 'v1')
    // A modest reword keeps similarity above REATTACH_THRESHOLD.
    const edited = DOC.replace('brown', 'reddish')

    const [reattached] = await resolveAnchors([{ id: 'r', anchor }], edited, 'v2')
    expect(reattached.outcome).toBe('re-attached')
    expect(reattached.resolvedAnchor).toBeDefined()

    const [unchanged] = await resolveAnchors([{ id: 'u', anchor }], DOC, 'v2')
    expect(unchanged.outcome).toBe('unchanged')
    expect(unchanged.resolvedAnchor).toBeUndefined()
  })

  it('resolves an empty batch to an empty array', async () => {
    await expect(resolveAnchors([], DOC, 'v2')).resolves.toEqual([])
  })
})

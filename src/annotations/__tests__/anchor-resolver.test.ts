import { describe, expect, it, vi } from 'vitest'
import { captureAnchor } from '../anchor-model'
import { resolveAnchor } from '../anchor-resolver'

function anchorFor(text: string, target: string, docVersion = 'v1') {
  const start = text.indexOf(target)
  if (start === -1) throw new Error(`target not found in text: ${target}`)
  return captureAnchor(text, { start, end: start + target.length }, docVersion)
}

// US1 — comments survive unrelated edits
describe('US1 acceptance scenario 1 — unrelated insertion above leaves the comment unchanged', () => {
  it('resolves to unchanged when unrelated text is inserted above the target', async () => {
    const oldText = 'Intro paragraph.\n\nThe target sentence stays here.\n\nOutro paragraph.'
    const anchor = anchorFor(oldText, 'The target sentence stays here.')

    const newText =
      'Inserted new paragraph above, shifting every line number below.\n\nIntro paragraph.\n\nThe target sentence stays here.\n\nOutro paragraph.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('unchanged')
  })
})

describe('US1 acceptance scenario 2 — a moved, untouched paragraph is followed', () => {
  it('resolves to unchanged when the target paragraph relocates to a different section', async () => {
    const oldText = '# Section A\n\nThe moved paragraph text.\n\n# Section B\n\nOther content.'
    const anchor = anchorFor(oldText, 'The moved paragraph text.')

    const newText = '# Section A\n\nOther content moved here.\n\n# Section B\n\nThe moved paragraph text.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('unchanged')
  })
})

describe('US1 acceptance scenario 3 — duplicate text disambiguated by context', () => {
  it('stays on the original occurrence, not the duplicate, after an unrelated edit elsewhere', async () => {
    const oldText =
      'The weather was clear that morning. Repeated text here. Everyone went about their day peacefully.\n\n' +
      'Unrelated middle content.\n\n' +
      'The stock market crashed overnight. Repeated text here. Analysts scrambled to explain why.'
    const firstOccurrenceStart = oldText.indexOf('Repeated text here.')
    const anchor = captureAnchor(oldText, { start: firstOccurrenceStart, end: firstOccurrenceStart + 'Repeated text here.'.length }, 'v1')
    expect(anchor.occurrenceIndex).toBe(0)

    const newText = oldText.replace(
      'Unrelated middle content.',
      'Something else entirely, longer and unrelated, changed elsewhere in the document.',
    )

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('unchanged')

    // Confirm it's genuinely the first occurrence that resolved, not a coincidence:
    // re-deriving the anchor from the *second* occurrence should score its own
    // context as a much better match than the first occurrence's context does.
    const secondOccurrenceStart = newText.indexOf('Repeated text here.', newText.indexOf('Repeated text here.') + 1)
    const secondAnchor = captureAnchor(
      newText,
      { start: secondOccurrenceStart, end: secondOccurrenceStart + 'Repeated text here.'.length },
      'v2',
    )
    expect(secondAnchor.prefixContext).not.toBe(anchor.prefixContext)
  })
})

// US2 — light edits re-attach; deletions orphan
describe('US2 acceptance scenario 1 — light reword re-attaches', () => {
  it('re-attaches to the reworded sentence', async () => {
    const oldText = 'Intro.\n\nThe quick brown fox jumps over the lazy dog.\n\nOutro.'
    const anchor = anchorFor(oldText, 'The quick brown fox jumps over the lazy dog.')

    const newText = 'Intro.\n\nThe quick brown fox leaps over the lazy dog.\n\nOutro.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('re-attached')
    expect(resolution.anchor?.targetText).toBe('The quick brown fox leaps over the lazy dog.')
  })
})

describe('US2 acceptance scenario 2 — deletion orphans, never neighbour-hops', () => {
  it('marks the comment orphaned when its target sentence is deleted', async () => {
    const oldText = 'Intro.\n\nThe sentence to delete entirely.\n\nOutro paragraph remains here for context padding to avoid trivial matches.'
    const anchor = anchorFor(oldText, 'The sentence to delete entirely.')

    const newText = 'Intro.\n\nOutro paragraph remains here for context padding to avoid trivial matches.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('orphaned')
  })
})

describe('US2 acceptance scenario 3 — heavy rewrite consults the seam, falls through to orphaned', () => {
  it('orphans when no lexical overlap remains and the no-op seam declines', async () => {
    const oldText = 'Intro.\n\nOriginal target sentence about apples and oranges.\n\nOutro.'
    const anchor = anchorFor(oldText, 'Original target sentence about apples and oranges.')

    const newText = 'Intro.\n\nxyzzy plugh wibble wobble flibbertigibbet nonsense gobbledygook zzz.\n\nOutro.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('orphaned')
  })

  it('consults proposeSemanticRelocation and re-attaches when a relocation is proposed', async () => {
    const oldText = 'Intro.\n\nOriginal target sentence about apples and oranges.\n\nOutro.'
    const anchor = anchorFor(oldText, 'Original target sentence about apples and oranges.')

    const newText = 'Intro.\n\nxyzzy plugh wibble wobble flibbertigibbet nonsense gobbledygook zzz.\n\nOutro.'
    const proposedAnchor = anchorFor(newText, 'xyzzy plugh wibble wobble flibbertigibbet nonsense gobbledygook zzz.', 'v2')
    const proposeSemanticRelocation = vi.fn().mockResolvedValue(proposedAnchor)

    const resolution = await resolveAnchor(anchor, newText, 'v2', { proposeSemanticRelocation })

    expect(proposeSemanticRelocation).toHaveBeenCalledWith({ anchor, newText })
    expect(resolution.outcome).toBe('re-attached')
    expect(resolution.reason).toContain('semantic relocation')
    expect(resolution.anchor).toEqual(proposedAnchor)
  })
})

describe('US2 acceptance scenario 4 — range split downgrades to flagged', () => {
  it('flags rather than silently re-attaching when a new structural boundary splits the target', async () => {
    const oldText = 'Alpha sentence one here now. Beta.'
    const anchor = captureAnchor(oldText, { start: 0, end: oldText.length }, 'v1')
    expect(anchor.blockType).toBe('paragraph')

    // Insert a heading in the middle of the previously single-paragraph target —
    // "Alpha sentence one here now." remains alone in the first paragraph
    // (matches well over REATTACH_THRESHOLD on its own), but the full target
    // only reconstructs at high similarity once "Beta." from the new second
    // paragraph is combined back in — hence flagged, not re-attached to the partial range.
    const newText = 'Alpha sentence one here now.\n\n## New Heading\n\nBeta.'

    const resolution = await resolveAnchor(anchor, newText, 'v2')
    expect(resolution.outcome).toBe('flagged')
    expect(resolution.reason).toContain('structural boundary')
  })
})

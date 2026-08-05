/**
 * PROVENANCE — ported from Zusammen (`verveguy/zusammen`) for Liminis #939
 * (SC-002/SC-003 evidence: these assertions carry over case-for-case).
 *
 * Doc comments below are the original author's, kept verbatim so the suite
 * stays diffable against its source. Their `FR-NNN`/`SC-NNN` identifiers and
 * `#NN` issue references name **Zusammen's** spec and issues, not this
 * repository's. "Comment" should be read as "annotation".
 */
import { describe, expect, it } from 'vitest'
import { ANCHOR_RESOLUTION_SCHEMA, ANCHOR_SCHEMA, captureAnchor, CONTEXT_WINDOW_CHARS } from '../anchor-model'

describe('captureAnchor', () => {
  it('captures the exact target text, context, block type, and docVersion', () => {
    const text = 'Intro paragraph.\n\nThe target sentence here.\n\nOutro paragraph.'
    const start = text.indexOf('The target sentence here.')
    const end = start + 'The target sentence here.'.length

    const anchor = captureAnchor(text, { start, end }, 'sha-1')

    expect(anchor.targetText).toBe('The target sentence here.')
    expect(anchor.blockType).toBe('paragraph')
    expect(anchor.docVersion).toBe('sha-1')
    expect(anchor.occurrenceIndex).toBe(0)
    expect(text.slice(0, start).endsWith(anchor.prefixContext)).toBe(true)
    expect(text.slice(end).startsWith(anchor.suffixContext)).toBe(true)
  })

  it('caps prefix/suffix context to CONTEXT_WINDOW_CHARS', () => {
    const long = 'x'.repeat(200)
    const text = `${long}TARGET${long}`
    const start = text.indexOf('TARGET')
    const end = start + 'TARGET'.length

    const anchor = captureAnchor(text, { start, end }, 'sha-1')

    expect(anchor.prefixContext.length).toBe(CONTEXT_WINDOW_CHARS)
    expect(anchor.suffixContext.length).toBe(CONTEXT_WINDOW_CHARS)
  })

  it('indexes duplicate target text by occurrence', () => {
    const text = 'Alpha. Repeated line. Beta. Repeated line. Gamma.'
    const firstStart = text.indexOf('Repeated line.')
    const secondStart = text.indexOf('Repeated line.', firstStart + 1)

    const first = captureAnchor(text, { start: firstStart, end: firstStart + 'Repeated line.'.length }, 'sha-1')
    const second = captureAnchor(text, { start: secondStart, end: secondStart + 'Repeated line.'.length }, 'sha-1')

    expect(first.occurrenceIndex).toBe(0)
    expect(second.occurrenceIndex).toBe(1)
  })

  it('records a null blockType when the range spans more than one block', () => {
    const text = 'First paragraph.\n\nSecond paragraph.'
    const anchor = captureAnchor(text, { start: 0, end: text.length }, 'sha-1')
    expect(anchor.blockType).toBeNull()
  })

  it('produces an anchor that validates against ANCHOR_SCHEMA', () => {
    const text = 'A single paragraph target.'
    const anchor = captureAnchor(text, { start: 0, end: text.length }, 'sha-1')
    expect(() => ANCHOR_SCHEMA.parse(anchor)).not.toThrow()
  })
})

describe('ANCHOR_RESOLUTION_SCHEMA', () => {
  it('accepts a resolution without an anchor (flagged/orphaned/unchanged)', () => {
    expect(() =>
      ANCHOR_RESOLUTION_SCHEMA.parse({ outcome: 'orphaned', docVersion: 'sha-2', reason: 'no lexical overlap' }),
    ).not.toThrow()
  })

  it('accepts a re-attached resolution carrying a fresh anchor', () => {
    const anchor = captureAnchor('Reworded target sentence.', { start: 0, end: 26 }, 'sha-2')
    expect(() =>
      ANCHOR_RESOLUTION_SCHEMA.parse({ outcome: 're-attached', docVersion: 'sha-2', reason: 'light reword', anchor }),
    ).not.toThrow()
  })

  it('rejects an unknown outcome value', () => {
    expect(() =>
      ANCHOR_RESOLUTION_SCHEMA.parse({ outcome: 'moved', docVersion: 'sha-2', reason: 'nope' }),
    ).toThrow()
  })
})

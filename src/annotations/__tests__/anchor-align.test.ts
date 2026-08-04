import { describe, expect, it } from 'vitest'
import { locateInSpan } from '../anchor-align'

describe('locateInSpan', () => {
  it('locates a unique exact match', () => {
    const span = 'The quick brown fox jumps over the lazy dog.'
    expect(locateInSpan(span, 'brown fox')).toEqual({ start: 10, end: 19 })
  })

  it('returns null when the target does not appear verbatim', () => {
    const span = 'The quick brown fox jumps over the lazy dog.'
    expect(locateInSpan(span, 'bold text')).toBeNull()
  })

  it('returns null for an empty target', () => {
    expect(locateInSpan('some text', '')).toBeNull()
  })

  it('disambiguates duplicate occurrences using surrounding context', () => {
    const span = 'First: the target text here. Second: the target text there.'
    const firstStart = span.indexOf('the target text here')
    const secondStart = span.indexOf('the target text there')

    const located = locateInSpan(span, 'the target text', {
      prefixContext: 'Second: ',
      suffixContext: ' there.',
    })

    expect(located).toEqual({ start: secondStart, end: secondStart + 'the target text'.length })
    expect(located?.start).not.toBe(firstStart)
  })

  it('disambiguates duplicate occurrences using occurrence index when context is absent', () => {
    const span = 'dup here. dup here. dup here.'
    const located = locateInSpan(span, 'dup here', { occurrenceIndex: 2 })
    const thirdStart = span.lastIndexOf('dup here')
    expect(located).toEqual({ start: thirdStart, end: thirdStart + 'dup here'.length })
  })
})

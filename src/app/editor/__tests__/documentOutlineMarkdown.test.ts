/**
 * Coverage for `deriveOutlineFromMarkdown`/`resolveActiveOutlineIndex`
 * (issue #84): heading derivation from markdown alone, source-line capture,
 * and active-index resolution — no Lexical, no React, no DOM. The
 * order/nesting/inline-code fixture below mirrors `OutlinePlugin.test.tsx`'s
 * equivalent Lexical-tree fixture so the two derivation paths stay in
 * parity (FR-002).
 */

import { describe, expect, it } from 'vitest'
import { deriveOutlineFromMarkdown, resolveActiveOutlineIndex } from '../documentOutlineMarkdown'

describe('deriveOutlineFromMarkdown', () => {
  it('renders no entries for markdown with no headings (FR-007)', () => {
    expect(deriveOutlineFromMarkdown('Just a paragraph.\n\nAnother one.')).toEqual([])
  })

  it('renders no entries for empty markdown', () => {
    expect(deriveOutlineFromMarkdown('')).toEqual([])
  })

  it('lists headings in document order, indexed and leveled, with skipped levels, duplicate titles, and inline code reduced to plain text (mirrors OutlinePlugin.test.tsx)', () => {
    const markdown = [
      '# Introduction',
      '',
      '### See `inline code`',
      '',
      '## Introduction',
      '',
      '##### Deeply nested',
      '',
    ].join('\n')

    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries).toEqual([
      { index: 0, level: 1, text: 'Introduction', line: 1 },
      { index: 1, level: 3, text: 'See inline code', line: 3 },
      { index: 2, level: 2, text: 'Introduction', line: 5 },
      { index: 3, level: 5, text: 'Deeply nested', line: 7 },
    ])
  })

  it('excludes h6 headings, since OutlineEntry.level has no slot for them', () => {
    const markdown = '# Title\n\n###### Too deep\n'
    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries).toEqual([{ index: 0, level: 1, text: 'Title', line: 1 }])
  })

  it('does not skip a heading whose extracted title is empty, diverging from the pre-extraction app', () => {
    const markdown = '#\n\n## Real heading\n'
    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries).toEqual([
      { index: 0, level: 1, text: '', line: 1 },
      { index: 1, level: 2, text: 'Real heading', line: 3 },
    ])
  })

  it('does not treat headings nested inside blockquotes as top-level entries, matching $getRoot().getChildren() semantics', () => {
    const markdown = '# Top\n\n> ## Nested in blockquote\n'
    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries).toEqual([{ index: 0, level: 1, text: 'Top', line: 1 }])
  })

  it('does not treat heading-like text inside a code fence as a heading', () => {
    const markdown = '# Real\n\n```\n# Not a heading\n```\n'
    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries).toEqual([{ index: 0, level: 1, text: 'Real', line: 1 }])
  })

  it('every entry carries a 1-based source line matching the heading position (SC-002)', () => {
    const markdown = 'preamble\n\n# One\n\nbody\n\nbody\n\n## Two\n'
    const entries = deriveOutlineFromMarkdown(markdown)
    expect(entries.map((e) => e.line)).toEqual([3, 9])
  })
})

describe('resolveActiveOutlineIndex', () => {
  const entries = deriveOutlineFromMarkdown('# One\n\nbody\n\n## Two\n\nbody\n\n### Three\n')
  // lines: One@1, Two@5, Three@9

  it('resolves null when line is null (no active heading yet)', () => {
    expect(resolveActiveOutlineIndex(entries, null)).toBeNull()
  })

  it('resolves null when line falls before the first heading', () => {
    expect(resolveActiveOutlineIndex([{ index: 0, level: 1, text: 'x', line: 5 }], 1)).toBeNull()
  })

  it('resolves the heading whose line the supplied line falls within or after, and before the next heading', () => {
    expect(resolveActiveOutlineIndex(entries, 1)).toBe(0)
    expect(resolveActiveOutlineIndex(entries, 4)).toBe(0)
    expect(resolveActiveOutlineIndex(entries, 5)).toBe(1)
    expect(resolveActiveOutlineIndex(entries, 8)).toBe(1)
    expect(resolveActiveOutlineIndex(entries, 9)).toBe(2)
    expect(resolveActiveOutlineIndex(entries, 100)).toBe(2)
  })

  it('resolves null for an empty entry list', () => {
    expect(resolveActiveOutlineIndex([], 10)).toBeNull()
  })
})

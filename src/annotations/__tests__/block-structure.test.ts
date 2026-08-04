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
import { blockPlainText, findEnclosingBlock, parseBlocks, sentenceChunks } from '../block-structure'

describe('parseBlocks', () => {
  it('finds a single paragraph block spanning the whole text', () => {
    const text = 'Just one paragraph of text.'
    const blocks = parseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe(text)
  })

  it('finds headings and paragraphs as separate blocks', () => {
    const text = '# Title\n\nParagraph one.\n\n## Section\n\nParagraph two.'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'paragraph'])
    expect(blockPlainText(blocks[1], text)).toBe('Paragraph one.')
    expect(blockPlainText(blocks[3], text)).toBe('Paragraph two.')
  })

  it('surfaces list item paragraphs as leaf blocks, transparent through list/listItem containers', () => {
    const text = '- First item\n- Second item\n- Third item'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(blocks.map((b) => blockPlainText(b, text))).toEqual(['First item', 'Second item', 'Third item'])
  })

  it('surfaces nested list item paragraphs at every depth', () => {
    const text = '- Outer item\n  - Inner item\n- Second outer'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => blockPlainText(b, text))).toEqual(['Outer item', 'Inner item', 'Second outer'])
  })

  it('treats table cells as leaf blocks, transparent through table/tableRow containers', () => {
    const text = '| A | B |\n| --- | --- |\n| one | two |'
    const blocks = parseBlocks(text)
    expect(blocks.every((b) => b.type === 'tableCell')).toBe(true)
    // Cell spans include their own delimiting pipe/space padding (an mdast-util-gfm
    // quirk), so compare on stripped content rather than the raw slice.
    const stripped = blocks.map((b) => blockPlainText(b, text).replace(/\|/g, '').trim())
    expect(stripped).toEqual(['A', 'B', 'one', 'two'])
  })

  it('treats a fenced code block as one leaf block, not split by internal newlines', () => {
    const text = 'Intro paragraph.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nOutro paragraph.'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'paragraph'])
    expect(blockPlainText(blocks[1], text)).toContain('const a = 1;')
    expect(blockPlainText(blocks[1], text)).toContain('const b = 2;')
  })

  it('surfaces a paragraph nested inside a blockquote as a leaf block', () => {
    const text = '> Quoted paragraph text.'
    const blocks = parseBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
    expect(blockPlainText(blocks[0], text)).toBe('Quoted paragraph text.')
  })

  it('finds a thematic break as its own block', () => {
    const text = 'Above.\n\n---\n\nBelow.'
    const blocks = parseBlocks(text)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'thematicBreak', 'paragraph'])
  })
})

describe('findEnclosingBlock', () => {
  it('returns the block containing a range fully inside one block', () => {
    const text = '# Title\n\nParagraph one. Paragraph two continued.'
    const blocks = parseBlocks(text)
    const idx = text.indexOf('Paragraph two')
    const block = findEnclosingBlock(blocks, idx, idx + 'Paragraph two'.length)
    expect(block?.type).toBe('paragraph')
  })

  it('returns undefined when the range spans two blocks', () => {
    const text = 'First paragraph.\n\nSecond paragraph.'
    const blocks = parseBlocks(text)
    const start = text.indexOf('First')
    const end = text.indexOf('Second paragraph.') + 'Second paragraph.'.length
    expect(findEnclosingBlock(blocks, start, end)).toBeUndefined()
  })
})

describe('sentenceChunks', () => {
  it('splits multiple sentences within a block', () => {
    const text = 'First sentence. Second sentence! Third sentence?'
    const chunks = sentenceChunks(text)
    expect(chunks.map((c) => c.text)).toEqual(['First sentence.', 'Second sentence!', 'Third sentence?'])
    for (const chunk of chunks) {
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text)
    }
  })

  it('splits on newlines within a block', () => {
    const text = 'Line one\nLine two'
    const chunks = sentenceChunks(text)
    expect(chunks.map((c) => c.text)).toEqual(['Line one', 'Line two'])
  })

  it('returns a single chunk for text with no sentence boundaries', () => {
    const text = 'just one sentence with no terminal punctuation'
    expect(sentenceChunks(text)).toEqual([{ text, start: 0, end: text.length }])
  })

  // Liminis-side addition (review finding, CodeRabbit): a bare `\n+` split left
  // the `\r` on the preceding chunk, so a fuzzy re-attach onto it would capture
  // a carriage return into the durable target text.
  it('splits on CRLF without leaving the carriage return on the preceding chunk', () => {
    const text = 'Line one\r\nLine two'
    const chunks = sentenceChunks(text)
    expect(chunks.map((c) => c.text)).toEqual(['Line one', 'Line two'])
    for (const chunk of chunks) {
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text)
    }
  })
})

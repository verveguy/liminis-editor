/**
 * Minimal Markdown Block Structure
 *
 * A lightweight, dependency-free-beyond-mdast reading of a markdown document's
 * block-level structure — used by the comment-anchoring resolver (issue #25) to
 * detect when a comment's target has crossed a structural boundary (FR-007) and
 * to scope fuzzy-matching search to sentence-sized units within a block instead
 * of comparing against an entire, possibly large, block of text.
 *
 * Deliberately separate from `editor/markdown/parse.ts`: that module carries
 * wiki-link/emphasis/frontmatter concerns for the live editor and lives under
 * the web-only tsconfig project, while this one runs in `src/main`/`src/shared`
 * against arbitrary git blob text with no DOM dependency.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'

// ============================================================================
// Blocks
// ============================================================================

/** mdast node types treated as leaf structural blocks — never recursed into further. */
const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'code', 'tableCell', 'thematicBreak'])

export type BlockType = 'paragraph' | 'heading' | 'code' | 'tableCell' | 'thematicBreak'

/** A leaf block's character-offset span within the document text it was parsed from. */
export interface Block {
  type: BlockType
  start: number
  end: number
}

interface MdastNode {
  type: string
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: MdastNode[]
}

/**
 * Parse a markdown document into its leaf structural blocks — paragraphs,
 * headings, code blocks, table cells, and thematic breaks — each carrying the
 * character-offset span it occupies in `text`. Container nodes (list,
 * listItem, blockquote, table, tableRow) are transparent: their block-level
 * content surfaces as the leaf blocks found inside them.
 */
export function parseBlocks(text: string): Block[] {
  const root = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as unknown as MdastNode

  const blocks: Block[] = []

  function walk(node: MdastNode | undefined): void {
    if (!node) return
    if (BLOCK_NODE_TYPES.has(node.type)) {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      if (start != null && end != null) {
        blocks.push({ type: node.type as BlockType, start, end })
      }
      return // leaf blocks have no nested blocks worth surfacing separately
    }
    if (node.children) {
      for (const child of node.children) walk(child)
    }
  }

  walk(root)
  blocks.sort((a, b) => a.start - b.start)
  return blocks
}

/**
 * Find the single block that fully contains `[start, end)`. Returns undefined
 * if no leaf block covers the whole range — either the range sits in
 * unstructured space (rare) or it straddles two blocks, which callers should
 * treat as a structural-boundary crossing (FR-007).
 */
export function findEnclosingBlock(blocks: readonly Block[], start: number, end: number = start): Block | undefined {
  return blocks.find((block) => block.start <= start && end <= block.end)
}

export function blockPlainText(block: Block, text: string): string {
  return text.slice(block.start, block.end)
}

// ============================================================================
// Sentence chunks
// ============================================================================

export interface SentenceChunk {
  text: string
  /** Offset relative to the start of the text passed to sentenceChunks. */
  start: number
  end: number
}

// Splits after sentence-ending punctuation followed by whitespace, or on any
// run of newlines. Naive by design (no NLP sentence-splitter dependency
// exists in this codebase) — can mis-split on abbreviations/decimals, which
// is acceptable for v1 fuzzy-matching scope.
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/

/**
 * Split a block's text into sentence-sized chunks, so a light reword of one
 * sentence in a multi-sentence block is compared against just that sentence
 * rather than the whole block. Uses the split regex's own match offsets
 * (rather than re-searching for each piece via `indexOf`) so a repeated
 * sentence can never be mis-offset onto a different occurrence.
 */
export function sentenceChunks(text: string): SentenceChunk[] {
  const chunks: SentenceChunk[] = []
  const delimiter = new RegExp(SENTENCE_SPLIT.source, 'g')
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = delimiter.exec(text))) {
    const piece = text.slice(cursor, match.index)
    if (piece.length > 0) chunks.push({ text: piece, start: cursor, end: match.index })
    cursor = delimiter.lastIndex
  }
  const tail = text.slice(cursor)
  if (tail.length > 0) chunks.push({ text: tail, start: cursor, end: text.length })
  return chunks
}

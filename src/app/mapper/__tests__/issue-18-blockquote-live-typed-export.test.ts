/**
 * Regression gate for #18's dual-shape handling in `convertQuoteNode`.
 *
 * `QuoteNode` is reachable two ways: markdown import, which (after this fix)
 * gives it real `ParagraphNode` children, and live typing via the editor's
 * "Quote" slash command (`SlashMenu.tsx`), which relies on Lexical's own
 * `registerRichText()` — never registers a paragraph wrapper for a quote, so
 * typed content lands as bare `TextNode`/`LineBreakNode` children directly
 * under the `QuoteNode`. This builds that second shape directly (bypassing
 * markdown import entirely, mirroring the #902 FR-004 direct-construction
 * test), and confirms `convertQuoteNode`'s buffer/flush loop still exports it
 * as a single correct paragraph rather than silently dropping the flat
 * children (which a naive `getChildren().forEach(convertLexicalNode)` would
 * do, since bare TextNode/LineBreakNode have no case in the block dispatcher).
 */
import { describe, it, expect } from 'vitest';
import { $getRoot, $createTextNode, $createLineBreakNode } from 'lexical';
import { $createQuoteNode } from '@lexical/rich-text';
import { createTestEditor } from './roundtrip-test-utils';
import { exportLexicalToMdast } from '../lexicalToMdast';

describe('Live-typed blockquote export (#18)', () => {
  it('exports a flat-children QuoteNode as a single paragraph', () => {
    const { editor, dispose } = createTestEditor();

    try {
      editor.update(
        () => {
          const quote = $createQuoteNode();
          quote.append($createTextNode('Line one'), $createLineBreakNode(), $createTextNode('Line two'));
          $getRoot().append(quote);
        },
        { discrete: true },
      );

      const mdast = exportLexicalToMdast(editor);

      expect(mdast.children).toHaveLength(1);
      const [blockquote] = mdast.children;
      expect(blockquote.type).toBe('blockquote');
      if (blockquote.type !== 'blockquote') throw new Error('expected a blockquote');
      expect(blockquote.children).toHaveLength(1);
      const [paragraph] = blockquote.children;
      expect(paragraph.type).toBe('paragraph');
      if (paragraph.type !== 'paragraph') throw new Error('expected a paragraph');
      expect(paragraph.children.map((c) => c.type)).toEqual(['text', 'break', 'text']);
    } finally {
      dispose();
    }
  });
});

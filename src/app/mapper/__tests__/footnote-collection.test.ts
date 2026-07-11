/**
 * Tests for footnote collection at bottom of document.
 *
 * Covers:
 * - preprocessFootnoteDefinitions (MDAST extraction)
 * - Full round-trip: markdown → MDAST → Lexical → MDAST → markdown
 * - splitFootnoteSection + groupFootnoteChildren (Lexical → MDAST export)
 */
import { describe, it, expect } from 'vitest';
import { $getRoot, LexicalEditor, ElementNode } from 'lexical';
import { $isFootnoteNode } from '../../editor/nodes';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexical } from '../mdastToLexical';
import { createTestEditor, roundTrip } from './roundtrip-test-utils';

/**
 * Import helper: markdown → Lexical, returns a snapshot of the root children.
 */
function importToLexical(markdown: string): Promise<{ types: string[]; childCount: number; editor: LexicalEditor }> {
  return new Promise((resolve) => {
    const editor = createTestEditor();
    const parsed = parseMarkdown(markdown);

    editor.update(
      () => {
        importMarkdownToLexical(editor, parsed.root);
      },
      {
        discrete: true,
        onUpdate: () => {
          editor.getEditorState().read(() => {
            const root = $getRoot();
            const children = root.getChildren();
            const types = children.map((c) => c.getType());
            resolve({ types, childCount: children.length, editor });
          });
        },
      },
    );
  });
}

describe('Footnote collection at bottom of document', () => {
  describe('import (mdastToLexical)', () => {
    it('should collect a single footnote definition at the bottom after an HR', async () => {
      const md = `Some text with a reference[^1].

[^1]: This is the footnote.`;

      const result = await importToLexical(md);
      // Expect: paragraph, HR, footnote-def paragraph
      expect(result.types).toEqual(['paragraph', 'horizontalrule', 'paragraph']);
    });

    it('should collect multiple footnote definitions at the bottom', async () => {
      const md = `Text[^1] and more[^2].

[^1]: First footnote.

[^2]: Second footnote.`;

      const result = await importToLexical(md);
      // paragraph, HR, def1, def2
      expect(result.types).toEqual(['paragraph', 'horizontalrule', 'paragraph', 'paragraph']);
    });

    it('should not add HR when no footnote definitions exist', async () => {
      const md = `Just a normal paragraph.

Another paragraph.`;

      const result = await importToLexical(md);
      expect(result.types).not.toContain('horizontalrule');
    });

    it('should extract footnote definitions nested in a blockquote', async () => {
      const md = `> A quote with a footnote[^1].
>
> [^1]: Defined inside the quote.`;

      const result = await importToLexical(md);
      // blockquote (without def), HR, def
      const hasHR = result.types.includes('horizontalrule');
      expect(hasHR).toBe(true);
    });

    it('should extract footnote definitions nested in a list', async () => {
      const md = `- List item[^1]

  [^1]: Defined inside the list.`;

      const result = await importToLexical(md);
      const hasHR = result.types.includes('horizontalrule');
      expect(hasHR).toBe(true);
    });

    it('should preserve source order of definitions', async () => {
      const md = `Text[^b] and[^a].

[^b]: Beta definition.

[^a]: Alpha definition.`;

      const result = await importToLexical(md);

      // Verify order by checking footnote labels in the editor
      result.editor.getEditorState().read(() => {
        const root = $getRoot();
        const children = root.getChildren();
        // Find the footnote definition paragraphs (after HR)
        const hrIndex = children.findIndex((c) => c.getType() === 'horizontalrule');
        const defParagraphs = children.slice(hrIndex + 1);
        expect(defParagraphs).toHaveLength(2);

        // First def should be [^b] (source order)
        const firstChild0 = (defParagraphs[0] as ElementNode).getFirstChild();
        expect(firstChild0).not.toBeNull();
        expect($isFootnoteNode(firstChild0)).toBe(true);
        if ($isFootnoteNode(firstChild0)) {
          expect(firstChild0.getFootnoteId()).toBe('b');
        }

        // Second def should be [^a]
        const firstChild1 = (defParagraphs[1] as ElementNode).getFirstChild();
        expect($isFootnoteNode(firstChild1)).toBe(true);
        if ($isFootnoteNode(firstChild1)) {
          expect(firstChild1.getFootnoteId()).toBe('a');
        }
      });
    });
  });

  describe('round-trip preservation', () => {
    it('should round-trip a single footnote definition', async () => {
      const md = `Some text with a reference[^1].

[^1]: This is the footnote.`;

      const { mdast } = await roundTrip(md);

      // MDAST should contain a footnoteDefinition node
      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(1);
      expect((fnDefs[0] as any).identifier).toBe('1');
    });

    it('should round-trip multiple footnote definitions', async () => {
      const md = `Text[^1] and more[^2].

[^1]: First footnote.

[^2]: Second footnote.`;

      const { mdast } = await roundTrip(md);

      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(2);
      expect((fnDefs[0] as any).identifier).toBe('1');
      expect((fnDefs[1] as any).identifier).toBe('2');
    });

    it('should not produce a thematicBreak in MDAST output', async () => {
      const md = `Text[^1].

[^1]: A footnote.`;

      const { mdast } = await roundTrip(md);

      // The separator HR should NOT appear in the exported MDAST
      const breaks = mdast.children.filter((c) => c.type === 'thematicBreak');
      expect(breaks).toHaveLength(0);
    });

    it('should round-trip footnote with a link', async () => {
      const md = `Text[^1].

[^1]: See [example](https://example.com) for details.`;

      const { mdast } = await roundTrip(md);

      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(1);

      // Check that the link is preserved in the definition content
      const para = (fnDefs[0] as any).children[0];
      expect(para.type).toBe('paragraph');
      const link = para.children.find((c: any) => c.type === 'link');
      expect(link).toBeDefined();
      expect(link.url).toBe('https://example.com');
    });

    it('should round-trip footnote with a footnote reference inside', async () => {
      const md = `Text[^1][^2].

[^1]: First, see also[^2].

[^2]: Second footnote.`;

      const { mdast } = await roundTrip(md);

      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(2);

      // First definition should contain a footnoteReference to [^2]
      const para = (fnDefs[0] as any).children[0];
      const fnRef = para.children.find((c: any) => c.type === 'footnoteReference');
      expect(fnRef).toBeDefined();
      expect(fnRef.identifier).toBe('2');
    });

    it('should round-trip multi-paragraph footnote definitions', async () => {
      const md = `Text[^1].

[^1]: First paragraph of the footnote.

    Second paragraph of the footnote.`;

      const { mdast } = await roundTrip(md);

      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(1);

      // Should have 2 paragraph children
      const def = fnDefs[0] as any;
      expect(def.identifier).toBe('1');
      expect(def.children).toHaveLength(2);
      expect(def.children[0].type).toBe('paragraph');
      expect(def.children[1].type).toBe('paragraph');
    });

    it('should round-trip document with no footnotes unchanged', async () => {
      const md = `Just a paragraph.

Another paragraph.`;

      const { mdast } = await roundTrip(md);

      expect(mdast.children.filter((c) => c.type === 'footnoteDefinition')).toHaveLength(0);
      expect(mdast.children.filter((c) => c.type === 'thematicBreak')).toHaveLength(0);
    });

    it('should preserve an existing thematic break that is not a footnote separator', async () => {
      const md = `Before the break.

---

After the break.`;

      const { mdast } = await roundTrip(md);

      const breaks = mdast.children.filter((c) => c.type === 'thematicBreak');
      expect(breaks).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle footnote definitions extracted from nested blockquotes', async () => {
      const md = `> Quoted text[^1].
>
> [^1]: Footnote inside quote.`;

      const { mdast } = await roundTrip(md);

      // Definition should be extracted and placed at root level
      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(1);
      expect((fnDefs[0] as any).identifier).toBe('1');
    });

    it('should handle duplicate footnote identifiers', async () => {
      const md = `Text[^1].

[^1]: First definition.

[^1]: Duplicate definition.`;

      const { mdast } = await roundTrip(md);

      // Both should be preserved
      const fnDefs = mdast.children.filter((c) => c.type === 'footnoteDefinition');
      expect(fnDefs).toHaveLength(2);
    });
  });
});

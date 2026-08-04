/**
 * PROVENANCE — ported from Zusammen (`verveguy/zusammen`) for Liminis #939
 * (SC-002/SC-003 evidence: these assertions carry over case-for-case).
 *
 * Doc comments below are the original author's, kept verbatim so the suite
 * stays diffable against its source. Their `FR-NNN`/`SC-NNN` identifiers and
 * `#NN` issue references name **Zusammen's** spec and issues, not this
 * repository's. "Comment" should be read as "annotation".
 */
/**
 * Mark transparency (#43): a `MarkNode` (the live comment anchor) must never
 * change what gets serialized — wrapping an arbitrary span of a document's
 * content in a mark and exporting must produce byte-identical markdown to
 * exporting the same document unwrapped (SC-002/FR-002).
 *
 * Exercises the real production pipeline (parseMarkdown -> importMarkdownToLexical
 * -> [wrap a span in a MarkNode] -> exportLexicalToMdast -> stringifyMarkdown),
 * including the case that previously would have regressed: a mark starting or
 * ending mid-bold/italic run, which splits one formatted TextNode into several
 * same-format siblings that lexicalToMdast.ts's convertInlineChildren must
 * still merge into a single wrapper on export (see effectiveChildren).
 */
import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode, $isTextNode, $createRangeSelection, $setSelection, type LexicalNode } from 'lexical';
import { $wrapSelectionInMarkNode, $createMarkNode } from '@lexical/mark';
import { $isFootnoteNode } from '../../editor/nodes';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../mdastToLexical';
import { exportLexicalToMdast, markCloseToken, markOpenToken, setAnnotateTarget } from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor } from './roundtrip-test-utils';

/**
 * Wraps the first occurrence of `target` (a plain-text substring of the
 * document's rendered text) in a `MarkNode`, splitting text nodes at its
 * boundaries exactly as a real selection-driven capture would. Must run
 * inside an active `editor.update()`.
 */
function wrapPlainTextInMark(target: string, id = 'test-mark'): void {
  const root = $getRoot();
  for (const textNode of root.getAllTextNodes()) {
    const text = textNode.getTextContent();
    const idx = text.indexOf(target);
    if (idx === -1) continue;

    const selection = $createRangeSelection();
    selection.anchor.set(textNode.getKey(), idx, 'text');
    selection.focus.set(textNode.getKey(), idx + target.length, 'text');
    $setSelection(selection);
    $wrapSelectionInMarkNode(selection, false, id);
    return;
  }
  throw new Error(`wrapPlainTextInMark: target not found: ${JSON.stringify(target)}`);
}

async function exportMarkdown(
  markdown: string,
  wrap?: (root: ReturnType<typeof $getRoot>) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { editor, dispose } = createTestEditor((error) => reject(error));
    const parsed = parseMarkdown(markdown);

    editor.update(
      () => {
        // Call the state-level import directly rather than the editor.update()-wrapping
        // importMarkdownToLexical: nesting editor.update() inside an already-active
        // update queues it for later (Lexical's updateEditor), so a synchronous
        // wrap() right after it would run against the still-empty root.
        importMarkdownToLexicalInEditorState(parsed.root);
        if (wrap) wrap($getRoot());
      },
      {
        discrete: true,
        onUpdate: () => {
          try {
            const mdast = exportLexicalToMdast(editor);
            resolve(stringifyMarkdown(mdast));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            dispose();
          }
        },
      },
    );
  });
}

describe('MarkNode transparency on export (#43)', () => {
  it('a mark wrapping a plain paragraph word serializes identically to the unwrapped document', async () => {
    const md = 'The quick brown fox jumps over the lazy dog.\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('brown fox'));
    expect(wrapped).toBe(md);
  });

  it('a mark wrapping text inside a list item serializes identically', async () => {
    const md = '- first item\n- second item with important text\n- third item\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('important text'));
    expect(wrapped).toBe(md);
  });

  it('a mark wrapping text inside a table cell serializes identically', async () => {
    // Uses a single-dash separator (`| - |`), not `---`: mdast-util-to-markdown
    // normalizes table separators to the minimal width regardless of marks —
    // a pre-existing, unrelated round-trip quirk this test must not trip over.
    const md = '| A | B |\n| - | - |\n| one | target cell text |\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('target cell'));
    expect(wrapped).toBe(md);
  });

  it('a mark wrapping text inside a blockquote serializes identically', async () => {
    const md = '> a quoted passage worth commenting on\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('worth commenting'));
    expect(wrapped).toBe(md);
  });

  it('a mark wrapping text inside a nested list item serializes identically', async () => {
    const md = '- top\n  - nested item with detail\n- sibling\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('nested item'));
    expect(wrapped).toBe(md);
  });

  it('a mark starting mid-bold-run re-merges into a single strong wrapper on export', async () => {
    const md = 'hello **big world** end\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('big'));
    expect(wrapped).toBe(md);
  });

  it('a mark ending mid-bold-run re-merges into a single strong wrapper on export', async () => {
    const md = 'hello **big world** end\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('world'));
    expect(wrapped).toBe(md);
  });

  it('a mark wrapping an entire bold run (no split) still serializes identically', async () => {
    const md = 'hello **big world** end\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('big world'));
    expect(wrapped).toBe(md);
  });

  it('a mark spanning a heading and the following paragraph (multi-block) serializes identically', async () => {
    const md = '# A heading with words\n\nA paragraph right after it.\n';
    const wrapped = await exportMarkdown(md, () => {
      const root = $getRoot();
      const heading = root.getFirstChild();
      const paragraph = root.getLastChild();
      if (!heading || !paragraph || !$isElementNode(heading) || !$isElementNode(paragraph)) {
        throw new Error('expected heading + paragraph');
      }
      const headingText = heading.getChildren().find($isTextNode);
      const paragraphText = paragraph.getChildren().find($isTextNode);
      if (!headingText || !paragraphText) throw new Error('expected text nodes');

      // $wrapSelectionInMarkNode only wraps within one top-level block per
      // pass (it steps out at block boundaries) — a multi-block anchor is
      // realized as several MarkNodes sharing one id, the same pattern the
      // Lexical playground uses. Build both directly rather than via a single
      // cross-block RangeSelection.
      const idsA = ['multi-block-mark'];
      const markA = $createMarkNode(idsA);
      headingText.insertBefore(markA);
      markA.append(headingText);

      const markB = $createMarkNode(idsA);
      paragraphText.insertBefore(markB);
      markB.append(paragraphText);
    });
    expect(wrapped).toBe(md);
  });

  it('two overlapping marks (two comments on the same text) still serialize identically', async () => {
    const md = 'shared text between two comments\n';
    const wrapped = await exportMarkdown(md, () => {
      wrapPlainTextInMark('shared text', 'mark-a');
      wrapPlainTextInMark('shared text', 'mark-b');
    });
    expect(wrapped).toBe(md);
  });

  it("a mark wrapping a footnote definition's own label preserves the definition's body text on export", async () => {
    // Two FootnoteNodes exist in document order: the inline `[^1]` reference in
    // the body paragraph, then the definition's own label at the start of its
    // paragraph after the HR — wrap that second one (the label itself, as if a
    // comment's selection started right at/before it).
    const md = 'Some text with a reference[^1].\n\n[^1]: This is the footnote body text.\n';
    const wrapLabelInMark = (): void => {
      const footnoteNodes: LexicalNode[] = [];
      const visit = (node: LexicalNode): void => {
        if ($isFootnoteNode(node)) footnoteNodes.push(node);
        if ($isElementNode(node)) for (const child of node.getChildren()) visit(child);
      };
      visit($getRoot());
      const label = footnoteNodes[1];
      if (!label) throw new Error('expected a footnote definition label');
      const mark = $createMarkNode(['c1']);
      label.insertBefore(mark);
      mark.append(label);
    };

    // Compared against the unwrapped baseline, not the raw `md` input: footnote
    // definitions have a separate, pre-existing round-trip whitespace quirk
    // (see fixtures/roundtrip/footnotes.expected.md) unrelated to marks — this
    // test isolates mark-transparency itself (wrapping the label must not
    // change the output, whatever that output already is) from that quirk.
    const unwrapped = await exportMarkdown(md);
    const wrapped = await exportMarkdown(md, wrapLabelInMark);
    expect(wrapped).toBe(unwrapped);
    expect(wrapped).toContain('This is the footnote body text.');
  });

  it('a mark wrapping text in a heading with emoji (multi-code-unit characters) serializes identically', async () => {
    // Each emoji is a surrogate pair (2 UTF-16 code units) — exercises that mark-boundary
    // offsets agree with JS string indexing the same way plain-ASCII cases already do.
    const md = '## 🎉 Celebration time 🎉\n\nSome body text.\n';
    const wrapped = await exportMarkdown(md, () => wrapPlainTextInMark('Celebration time'));
    expect(wrapped).toBe(md);
  });
});

/**
 * Annotated-serialize sentinel survival (#47): the throwaway "annotated"
 * export mode a comment's markdown-slice capture relies on
 * (`setAnnotateTarget`, `comment-anchor-marks.ts`'s `locateLiveMarkdownRange`)
 * brackets a live mark's content with PUA sentinel tokens *before* running
 * the full `stringify.ts` pipeline — including its ~10 regex post-processing
 * passes (underscore unescaping, bracket unescaping, blank-line collapsing,
 * etc.). Those passes were written for real markdown content; this proves
 * they neither corrupt/strip the sentinel tokens nor get confused by their
 * presence into mangling the *real* content around them, and that disabling
 * annotate mode again afterward leaves the disk-write path exactly as before
 * (annotate mode must never leak into it — ADR-003/FR-003).
 */
describe('annotated-serialize sentinel survival under stringify post-processing (#47)', () => {
  async function exportAnnotated(markdown: string, id: string, wrap: (root: ReturnType<typeof $getRoot>) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const { editor, dispose } = createTestEditor((error) => reject(error));
      const parsed = parseMarkdown(markdown);

      editor.update(
        () => {
          importMarkdownToLexicalInEditorState(parsed.root);
          wrap($getRoot());
        },
        {
          discrete: true,
          onUpdate: () => {
            try {
              setAnnotateTarget(id);
              const mdast = exportLexicalToMdast(editor);
              resolve(stringifyMarkdown(mdast));
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            } finally {
              setAnnotateTarget(null);
              dispose();
            }
          },
        },
      );
    });
  }

  it('sentinel tokens for the target id survive intraword-underscore, bracket, and blank-line-collapsing post-processing intact', async () => {
    // Deliberately dense: an underscore-laden bold word (exercises the
    // intraword-underscore-unescape pass), immediately after a markdown link
    // (bracket-unescape pass), inside a paragraph that would otherwise
    // collapse blank lines around it.
    const md = 'See [the docs](https://example.com/a_b) about **snake_case_word** here.\n\n\nMore text.\n';
    const wrapped = await exportAnnotated(md, 'c1', () => wrapPlainTextInMark('snake_case_word', 'c1'));

    const openToken = markOpenToken('c1');
    const closeToken = markCloseToken('c1');
    expect(wrapped).toContain(openToken);
    expect(wrapped).toContain(closeToken);

    const firstOpen = wrapped.indexOf(openToken);
    const lastClose = wrapped.lastIndexOf(closeToken);
    const slice = wrapped.slice(firstOpen + openToken.length, lastClose);
    expect(slice).toBe('snake_case_word');

    // The real content immediately outside the sentinel-bracketed span must
    // be untouched by their presence — same prefix/suffix as an un-annotated export.
    expect(wrapped.slice(0, firstOpen)).toBe('See [the docs](https://example.com/a_b) about **');
    expect(wrapped.slice(lastClose + closeToken.length)).toBe('** here.\n\nMore text.\n');
  });

  it('annotate mode never leaks into the disk-write path once disabled', async () => {
    const md = 'See [the docs](https://example.com/a_b) about **snake_case_word** here.\n';
    await exportAnnotated(md, 'c1', () => wrapPlainTextInMark('snake_case_word', 'c1'));

    // A fresh, ordinary (non-annotated) export of the same document must be
    // byte-identical to the source — proving setAnnotateTarget(null) in the
    // prior export's `finally` actually cleared the module-level target.
    const disk = await exportMarkdown(md, () => wrapPlainTextInMark('snake_case_word', 'c1'));
    expect(disk).toBe(md);
  });
});

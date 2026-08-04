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
 * Parse-time offset decoration (#43's read pathway): each `OffsetSpan`
 * recovered by `importMarkdownToLexicalWithOffsets` must map a raw-markdown
 * character range onto the Lexical `TextNode` whose text is exactly that
 * substring of the source markdown — the offset->node lookup the load-time
 * mark-placement code depends on to wrap an anchor's `targetText` in a live
 * `MarkNode` with no fuzzy matching (FR-003/SC-003).
 */
import { describe, it, expect } from 'vitest';
import { $getNodeByKey } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../mdastToLexical';
import { createTestEditor } from './roundtrip-test-utils';

/**
 * Import `markdown` and return its recovered OffsetSpans plus the raw text
 * they're relative to. Runs the import inside a `discrete: true` update so
 * the resulting editor state is committed synchronously before this
 * resolves — a plain (non-discrete) `editor.update()` defers its commit to a
 * microtask, which would make an immediate `getEditorState().read()` see the
 * pre-import (empty) state.
 */
function importWithOffsets(markdown: string): Promise<{ spans: OffsetSpan[]; markdown: string; verify: (span: OffsetSpan) => string }> {
  return new Promise((resolve, reject) => {
    const { editor } = createTestEditor((error) => reject(error));
    const parsed = parseMarkdown(markdown);
    let spans: OffsetSpan[] = [];
    editor.update(
      () => {
        spans = importMarkdownToLexicalInEditorStateWithOffsets(parsed.root);
      },
      {
        discrete: true,
        onUpdate: () => {
          const verify = (span: OffsetSpan): string =>
            editor.getEditorState().read(() => $getNodeByKey(span.nodeKey)?.getTextContent() ?? '<missing node>');
          resolve({ spans, markdown, verify });
        },
      },
    );
  });
}

describe('OffsetSpan recovery (#43 read pathway)', () => {
  it('recovers a paragraph leaf span matching the source substring exactly', async () => {
    const { spans, markdown, verify } = await importWithOffsets('A simple paragraph of text.\n');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(verify(span)).toBe(markdown.slice(span.start, span.end));
    }
  });

  it('recovers a heading leaf span matching the source substring exactly', async () => {
    const { spans, markdown, verify } = await importWithOffsets('## A Heading With Words\n');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(verify(span)).toBe(markdown.slice(span.start, span.end));
    }
  });

  it('recovers list item leaf spans matching the source substring exactly', async () => {
    const { spans, markdown, verify } = await importWithOffsets('- first item\n- second item\n- third item\n');
    expect(spans.length).toBeGreaterThanOrEqual(3);
    for (const span of spans) {
      expect(verify(span)).toBe(markdown.slice(span.start, span.end));
    }
  });

  it('recovers table cell leaf spans matching the source substring exactly', async () => {
    const { spans, markdown, verify } = await importWithOffsets('| A | B |\n| - | - |\n| one | two |\n');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(verify(span)).toBe(markdown.slice(span.start, span.end));
    }
  });

  it('recovers a blockquote leaf span matching the source substring exactly', async () => {
    const { spans, markdown, verify } = await importWithOffsets('> a quoted passage\n');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(verify(span)).toBe(markdown.slice(span.start, span.end));
    }
  });

  it('recovers bold/italic leaf spans excluding their markdown delimiters', async () => {
    const { spans, markdown, verify } = await importWithOffsets('hello **big** and *small* end\n');
    const bigSpan = spans.find((s) => markdown.slice(s.start, s.end) === 'big');
    const smallSpan = spans.find((s) => markdown.slice(s.start, s.end) === 'small');
    expect(bigSpan).toBeDefined();
    expect(smallSpan).toBeDefined();
    expect(verify(bigSpan!)).toBe('big');
    expect(verify(smallSpan!)).toBe('small');
  });

  it('recovers inline code leaf spans', async () => {
    const { spans, markdown, verify } = await importWithOffsets('call `doThing()` now\n');
    const codeSpan = spans.find((s) => markdown.slice(s.start, s.end).includes('doThing'));
    expect(codeSpan).toBeDefined();
    expect(verify(codeSpan!)).toBe(markdown.slice(codeSpan!.start, codeSpan!.end));
  });

  it('returns spans sorted by start offset', async () => {
    const { spans } = await importWithOffsets('one **two** three [four](https://example.com) five\n');
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].start);
    }
  });

  it('recovers a heading span after emoji (multi-code-unit characters), matching JS string indexing', async () => {
    const { spans, markdown, verify } = await importWithOffsets('## 🎉 Celebration time 🎉\n');
    const span = spans.find((s) => markdown.slice(s.start, s.end).includes('Celebration time'));
    expect(span).toBeDefined();
    expect(verify(span!)).toBe(markdown.slice(span!.start, span!.end));
  });
});

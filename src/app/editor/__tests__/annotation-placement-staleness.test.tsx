/**
 * The spec's async-resolution edge case: "a document edited again
 * mid-resolution must not apply stale marker placements."
 *
 * There is no dedicated staleness guard, and deliberately so — the existing
 * text re-verification in `placeMarkForAnchor` already *is* one. It locates the
 * anchor's target text in the current markdown and refuses to place when it
 * can't, so an anchor resolved against an older document version simply fails
 * to place rather than landing on unrelated text. When the next parse produces
 * fresh offset spans, the same anchor is retried and succeeds.
 *
 * These tests pin that behaviour directly, so the absence of a guard is a
 * tested property rather than an assumption.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import {
  importMarkdownToLexicalInEditorStateWithOffsets,
  type OffsetSpan,
} from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { captureAnchor } from '../../../annotations/anchor-model';
import { placeMarkForAnchor, hasLiveMark } from '../annotation-marks';

const ORIGINAL = 'The quick brown fox jumps over the lazy dog.\n';
const EDITED = 'The sluggish purple mongoose naps beside the lazy dog.\n';

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

function mount(markdown: string): { editor: LexicalEditor; spans: OffsetSpan[] } {
  container = document.createElement('div');
  container.contentEditable = 'true';
  document.body.appendChild(container);

  const editor = createEditor({
    namespace: 'staleness-test',
    nodes: editorNodes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(container);

  let spans: OffsetSpan[] = [];
  editor.update(
    () => {
      spans = importMarkdownToLexicalInEditorStateWithOffsets(parseMarkdown(markdown).root);
    },
    { discrete: true },
  );

  return { editor, spans };
}

describe('stale anchor placement', () => {
  it('places a mark when the anchor still matches the current document', () => {
    const { editor, spans } = mount(ORIGINAL);
    const anchor = captureAnchor(ORIGINAL, { start: 4, end: 19 }, 'v1'); // "quick brown fox"

    const placed = placeMarkForAnchor(editor, spans, ORIGINAL, anchor, 'a1');

    expect(placed).toBe(true);
    expect(hasLiveMark(editor, 'a1')).toBe(true);
  });

  it('refuses to place a stale anchor whose target text is gone — no mark on unrelated text', () => {
    // The anchor was captured against ORIGINAL, but the document is now EDITED
    // and the target text no longer exists anywhere in it.
    const anchor = captureAnchor(ORIGINAL, { start: 4, end: 19 }, 'v1');
    const { editor, spans } = mount(EDITED);

    const placed = placeMarkForAnchor(editor, spans, EDITED, anchor, 'a1');

    expect(placed).toBe(false);
    expect(hasLiveMark(editor, 'a1')).toBe(false);
  });

  it('recovers on the next parse: the same anchor places once fresh spans match again', () => {
    const anchor = captureAnchor(ORIGINAL, { start: 4, end: 19 }, 'v1');

    // First pass: document is edited, placement declines.
    const stale = mount(EDITED);
    expect(placeMarkForAnchor(stale.editor, stale.spans, EDITED, anchor, 'a1')).toBe(false);
    container?.remove();

    // Next parse restores matching content; the very same anchor now places.
    const fresh = mount(ORIGINAL);
    expect(placeMarkForAnchor(fresh.editor, fresh.spans, ORIGINAL, anchor, 'a1')).toBe(true);
    expect(hasLiveMark(fresh.editor, 'a1')).toBe(true);
  });

  it('is idempotent — re-running placement for an id that already has a mark is a no-op', () => {
    const { editor, spans } = mount(ORIGINAL);
    const anchor = captureAnchor(ORIGINAL, { start: 4, end: 19 }, 'v1');

    expect(placeMarkForAnchor(editor, spans, ORIGINAL, anchor, 'a1')).toBe(true);
    expect(placeMarkForAnchor(editor, spans, ORIGINAL, anchor, 'a1')).toBe(true);
    expect(container!.querySelectorAll('mark').length).toBe(1);
  });
});

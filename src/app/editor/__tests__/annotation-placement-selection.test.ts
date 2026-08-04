/**
 * Two review findings from the Validate round, both about state that placement
 * mutates behind the caller's back.
 *
 * 1. **Placement clobbered the user's selection** (CodeRabbit). Placement is a
 *    background operation — it runs whenever a re-parse invalidates the offset
 *    table, not in response to anything the user did — but it moved the caret
 *    twice per anchor: `$placeMarkForAnchor` sets the range it is about to
 *    wrap, and `$wrapSelectionInMarkNode` then collapses the selection into
 *    the mark it just created. So a document with live annotations yanked the
 *    caret into the last-placed mark while the user was typing.
 *
 * 2. **Annotated-serialize mode is not re-entrant** (@handarbeit-pruefer).
 *    `setAnnotateTarget` writes module-level sentinel state shared by every
 *    editor in the process. Safe today only because the one caller is
 *    synchronous — now asserted rather than assumed, so a future async slip or
 *    second call site fails loudly instead of silently producing a wrong
 *    anchor range.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, $createRangeSelection, $setSelection, createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { placeMarksForAnchors, placeMarkForAnchor, markElementsForId } from '../annotation-marks';
import { setAnnotateTarget } from '../../mapper/lexicalToMdast';
import { captureAnchor } from '../../../annotations/anchor-model';

let mounted: HTMLElement | null = null;
afterEach(() => {
  mounted?.remove();
  mounted = null;
  // Never leave annotate mode on for the next test, whatever this one did.
  setAnnotateTarget(null);
});

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n';

function importWithOffsets(markdown: string): Promise<{ editor: LexicalEditor; spans: OffsetSpan[] }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({ namespace: 'selection-test', nodes: editorNodes, onError: reject });
    const el = document.createElement('div');
    el.contentEditable = 'true';
    document.body.appendChild(el);
    mounted = el;
    editor.setRootElement(el);
    const parsed = parseMarkdown(markdown);
    let spans: OffsetSpan[] = [];
    editor.update(
      () => {
        spans = importMarkdownToLexicalInEditorStateWithOffsets(parsed.root);
      },
      { discrete: true, onUpdate: () => resolve({ editor, spans }) },
    );
  });
}

/** Puts a collapsed caret at `offset` in the document's first text node. */
function placeCaret(editor: LexicalEditor, offset: number): void {
  editor.update(
    () => {
      const textNode = $getRoot().getAllTextNodes()[0];
      const selection = $createRangeSelection();
      selection.anchor.set(textNode.getKey(), offset, 'text');
      selection.focus.set(textNode.getKey(), offset, 'text');
      $setSelection(selection);
    },
    { discrete: true },
  );
}

/**
 * The caret as a character offset across the whole document, which is the only
 * stable way to compare across a placement: wrapping splits text nodes, so the
 * same screen position legitimately gets a different `(key, offset)` pair.
 * Returns null when there is no range selection.
 */
function caretOffset(editor: LexicalEditor): number | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    let seen = 0;
    for (const node of $getRoot().getAllTextNodes()) {
      if (node.getKey() === selection.anchor.key) return seen + selection.anchor.offset;
      seen += node.getTextContentSize();
    }
    return null;
  });
}

describe('placement preserves the user selection', () => {
  it('leaves the caret where it was after a single placement', async () => {
    const { editor, spans } = await importWithOffsets(MARKDOWN);
    // Caret in "dog", well clear of the text being marked — and *after* it, the
    // side a key-based restore could not have recovered (the wrap splits the
    // node and Lexical keeps the original key on the first segment).
    const before = MARKDOWN.indexOf('dog');
    placeCaret(editor, before);

    const anchor = captureAnchor(MARKDOWN, { start: 4, end: 9 }, 'v1'); // "quick"
    expect(placeMarkForAnchor(editor, spans, MARKDOWN, anchor, 'a1')).toBe(true);

    expect(caretOffset(editor)).toBe(before);
  });

  it('leaves the caret where it was after a batch placement', async () => {
    const { editor, spans } = await importWithOffsets(MARKDOWN);
    const before = MARKDOWN.indexOf('jumps');
    placeCaret(editor, before);

    const entries = [
      { id: 'a1', anchor: captureAnchor(MARKDOWN, { start: 4, end: 9 }, 'v1') }, // quick
      { id: 'a2', anchor: captureAnchor(MARKDOWN, { start: 16, end: 19 }, 'v1') }, // fox
    ];
    expect(placeMarksForAnchors(editor, spans, MARKDOWN, entries).sort()).toEqual(['a1', 'a2']);

    expect(caretOffset(editor)).toBe(before);
    // ...and the marks really did land, so this is not passing by placing nothing.
    expect(markElementsForId(editor, 'a1').length).toBeGreaterThan(0);
    expect(markElementsForId(editor, 'a2').length).toBeGreaterThan(0);
  });

  it('restores to a valid point even when the caret sat inside the text being marked', async () => {
    const { editor, spans } = await importWithOffsets(MARKDOWN);
    // Caret inside "quick" itself — the node it names is about to be split
    // three ways, so this is the case a key-based restore handles worst.
    placeCaret(editor, 6);

    const anchor = captureAnchor(MARKDOWN, { start: 4, end: 9 }, 'v1'); // "quick"
    expect(placeMarkForAnchor(editor, spans, MARKDOWN, anchor, 'a1')).toBe(true);

    expect(caretOffset(editor)).toBe(6);
    // The restored point must also be valid in the current tree, not merely
    // arithmetically right.
    const valid = editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      return selection.anchor.offset <= selection.anchor.getNode().getTextContentSize();
    });
    expect(valid).toBe(true);
  });
});

describe('annotated-serialize mode is not re-entrant', () => {
  it('throws when enabled while already enabled, naming both ids', () => {
    setAnnotateTarget('first');
    expect(() => setAnnotateTarget('second')).toThrow(/already active for "first"/);
    setAnnotateTarget(null);
  });

  it('can be re-enabled once disabled, so the normal set/export/reset cycle is unaffected', () => {
    setAnnotateTarget('a');
    setAnnotateTarget(null);
    expect(() => setAnnotateTarget('b')).not.toThrow();
    setAnnotateTarget(null);
  });
});

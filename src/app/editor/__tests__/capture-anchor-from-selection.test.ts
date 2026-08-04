/**
 * The shared selection→anchor capture primitive (SC-001).
 *
 * `captureAnchorFieldsFromSelection` is the single path both annotation kinds
 * take from a user selection to a durable anchor. The `retainMark` option is
 * the entire difference between them: comments keep the mark (it becomes the
 * live anchor and the composer's highlight), corrections discard it so nothing
 * ever paints — which is what lets corrections route through the mechanism
 * without gaining an in-document marker they never had (FR-006 parity).
 *
 * These tests pin exactly that: identical anchor fields either way, mark
 * present or absent afterwards accordingly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { $getRoot, $isElementNode, createEditor, type LexicalEditor, type LexicalNode } from 'lexical';
import { $isMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { captureAnchorFieldsFromSelection, hasLiveMark } from '../annotation-marks';

const MARKDOWN = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph here.\n';

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

/** Mounts a real contentEditable so native DOM Ranges resolve onto Lexical nodes. */
function mountEditor(markdown: string): LexicalEditor {
  container = document.createElement('div');
  container.contentEditable = 'true';
  document.body.appendChild(container);

  const editor = createEditor({
    namespace: 'capture-test',
    nodes: editorNodes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(container);

  editor.update(
    () => {
      importMarkdownToLexicalInEditorState(parseMarkdown(markdown).root);
    },
    { discrete: true },
  );

  return editor;
}

/** A native Range over `[start, end)` of the first text node containing `needle`. */
function rangeOverText(needle: string): Range {
  const walker = document.createTreeWalker(container!, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      return range;
    }
  }
  throw new Error(`no text node containing ${JSON.stringify(needle)}`);
}

function markCount(editor: LexicalEditor): number {
  return editor.getEditorState().read(() => {
    let count = 0;
    const visit = (node: LexicalNode): void => {
      if ($isMarkNode(node)) count++;
      if ($isElementNode(node)) for (const child of node.getChildren()) visit(child);
    };
    visit($getRoot());
    return count;
  });
}

describe('captureAnchorFieldsFromSelection', () => {
  it('captures anchor fields and retains the mark when retainMark is true (comment kind)', () => {
    const editor = mountEditor(MARKDOWN);
    const fields = captureAnchorFieldsFromSelection(editor, rangeOverText('quick brown fox'), 'c1', {
      retainMark: true,
    });

    expect(fields?.targetText).toBe('quick brown fox');
    expect(hasLiveMark(editor, 'c1')).toBe(true);
    expect(markCount(editor)).toBe(1);
  });

  it('captures the same anchor fields but leaves no mark when retainMark is false (correction kind)', () => {
    const editor = mountEditor(MARKDOWN);
    const fields = captureAnchorFieldsFromSelection(editor, rangeOverText('quick brown fox'), 'x1', {
      retainMark: false,
    });

    expect(fields?.targetText).toBe('quick brown fox');
    expect(hasLiveMark(editor, 'x1')).toBe(false);
    expect(markCount(editor)).toBe(0);
  });

  it('produces identical anchor fields either way — the mark is presentation, not data', () => {
    const retained = captureAnchorFieldsFromSelection(
      mountEditor(MARKDOWN),
      rangeOverText('quick brown fox'),
      'c1',
      { retainMark: true },
    );
    container?.remove();

    const discarded = captureAnchorFieldsFromSelection(
      mountEditor(MARKDOWN),
      rangeOverText('quick brown fox'),
      'x1',
      { retainMark: false },
    );

    expect(discarded).toEqual(retained);
  });

  it('leaves the exported markdown byte-identical after a discarded capture', () => {
    const editor = mountEditor(MARKDOWN);
    const before = stringifyMarkdown(exportLexicalToMdast(editor));

    captureAnchorFieldsFromSelection(editor, rangeOverText('quick brown fox'), 'x1', {
      retainMark: false,
    });

    expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(before);
  });

  it('captures across a paragraph other than the first, anchoring to the right text', () => {
    const editor = mountEditor(MARKDOWN);
    const fields = captureAnchorFieldsFromSelection(editor, rangeOverText('second paragraph'), 'c2', {
      retainMark: true,
    });

    expect(fields?.targetText).toBe('second paragraph');
  });

  it('returns null and leaves no mark when the range selects nothing real', () => {
    const editor = mountEditor(MARKDOWN);
    const collapsed = rangeOverText('quick');
    collapsed.collapse(true);

    const fields = captureAnchorFieldsFromSelection(editor, collapsed, 'c3', { retainMark: true });

    expect(fields).toBeNull();
    expect(markCount(editor)).toBe(0);
  });
});

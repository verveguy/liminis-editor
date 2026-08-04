/**
 * Annotated-serialize mode brackets a mark's content with Private-Use-Area
 * sentinel tokens (`U+E000 <id> U+E001` … `U+E002 <id> U+E003`) and then finds
 * those tokens by string search. Review question (@handarbeit-pruefer): what
 * happens when the document's own text already contains PUA characters —
 * pasted from an icon font, or a PUA-mapped symbol set?
 *
 * `locateLiveMarkdownRange` ends with a verification step
 * (`markdownText.slice(start, end) !== rawSlice` → null), which is the guard
 * that is supposed to make this fail safe rather than mis-place. These tests
 * exercise it against real PUA content rather than assuming it holds:
 *
 * - stray PUA characters that are *not* a well-formed token are ordinary
 *   content, present in both the plain and annotated exports, so capture must
 *   still be exactly correct — not merely "not corrupt";
 * - text that reproduces the target id's own open token verbatim is the
 *   adversarial case, and must decline (anchor stays panel-only) rather than
 *   silently capturing the wrong range.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { readAnchorFields, wrapNativeRangeInMark, hasLiveMark } from '../annotation-marks';

const OPEN_START = '\u{E000}';
const OPEN_END = '\u{E001}';

let mountedElement: HTMLElement | null = null;
afterEach(() => {
  mountedElement?.remove();
  mountedElement = null;
});

function mountEditor(markdown: string): Promise<{ editor: LexicalEditor; element: HTMLElement }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({ namespace: 'pua-test', nodes: editorNodes, onError: reject });
    const el = document.createElement('div');
    el.contentEditable = 'true';
    document.body.appendChild(el);
    mountedElement = el;
    editor.setRootElement(el);
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(markdown).root);
      },
      { discrete: true, onUpdate: () => resolve({ editor, element: el }) },
    );
  });
}

/** A native Range over the first occurrence of `text` in the rendered DOM. */
function domRangeForText(element: HTMLElement, text: string): Range {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      return range;
    }
  }
  throw new Error(`no text node containing ${JSON.stringify(text)}`);
}

describe('annotated-serialize sentinels vs. pre-existing PUA content', () => {
  it('captures correctly when stray PUA characters sit right beside the annotated span', async () => {
    // Bare PUA code points as content — the icon-font paste case. They are not
    // well-formed tokens (no id, no closing code point), so they are just text.
    const md = `icon ${OPEN_START} before the target passage ${OPEN_END} after\n`;
    const { editor, element } = await mountEditor(md);

    wrapNativeRangeInMark(editor, domRangeForText(element, 'target passage'), 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(true);

    const fields = readAnchorFields(editor, 'c1');
    expect(fields).not.toBeNull();
    expect(fields!.targetText).toBe('target passage');
  });

  it('captures correctly when a stray PUA character falls inside the annotated span', async () => {
    const md = `lead in target ${OPEN_START} passage trailing\n`;
    const { editor, element } = await mountEditor(md);

    wrapNativeRangeInMark(editor, domRangeForText(element, `target ${OPEN_START} passage`), 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(true);

    const fields = readAnchorFields(editor, 'c1');
    expect(fields).not.toBeNull();
    expect(fields!.targetText).toBe(`target ${OPEN_START} passage`);
  });

  it('declines rather than mis-placing when the text reproduces the id\'s own open token', async () => {
    // The adversarial case: content containing `U+E000 c1 U+E001` verbatim, so
    // the `indexOf` for the real mark's open token finds this decoy first and
    // the derived range is wrong. The verification step must catch that.
    const decoy = `${OPEN_START}c1${OPEN_END}`;
    const md = `decoy ${decoy} then the target passage here\n`;
    const { editor, element } = await mountEditor(md);

    wrapNativeRangeInMark(editor, domRangeForText(element, 'target passage'), 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(true);

    // Verified empirically: this is the branch the verification step catches.
    // `null` means the anchor stays panel-only, which is the same safe
    // fallback every other unlocatable anchor takes — never a confident
    // capture of the wrong slice.
    expect(readAnchorFields(editor, 'c1')).toBeNull();
    // And the attempt leaves the document itself untouched.
    expect(hasLiveMark(editor, 'c1')).toBe(true);
  });
});

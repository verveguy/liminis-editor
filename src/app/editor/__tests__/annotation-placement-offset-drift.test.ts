/**
 * Regression for the placement-wiring bug fixed in Editor.tsx (#47 follow-up).
 *
 * `placeMarkForAnchor` finds the anchor's target in `markdownText` and maps the
 * located offsets through `offsetSpans`. Those two inputs MUST come from the
 * same markdown string. The editor's serializer is NOT idempotent — e.g. it
 * collapses the blank line before a list — so the raw on-disk markdown and the
 * editor's re-serialized markdown diverge. Editor.tsx used to build `offsetSpans`
 * from the raw file but hand placement the re-serialized string (`currentContentRef`,
 * overwritten by onChange); every offset past the first divergence was skewed and
 * the placed mark was truncated (a bold-label bullet lost its last two chars).
 * The fix pins placement to `offsetSourceRef` — the exact string the spans were
 * parsed from. These tests exercise `placeMarkForAnchor` directly to lock the
 * coordinate-consistency contract that fix depends on; full wiring coverage would
 * need a heavier Editor integration test (see the PR).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../../mapper/mdastToLexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { placeMarkForAnchor, markElementsForId } from '../annotation-marks';
import type { Anchor } from '../../../annotations/anchor-model';

let mounted: HTMLElement | null = null;
afterEach(() => { mounted?.remove(); mounted = null; });

function importWithOffsets(markdown: string): Promise<{ editor: LexicalEditor; spans: OffsetSpan[] }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({ namespace: 'test', nodes: editorNodes, onError: reject });
    const el = document.createElement('div');
    el.contentEditable = 'true';
    document.body.appendChild(el);
    mounted = el;
    editor.setRootElement(el);
    const parsed = parseMarkdown(markdown);
    let spans: OffsetSpan[] = [];
    editor.update(
      () => { spans = importMarkdownToLexicalInEditorStateWithOffsets(parsed.root); },
      { discrete: true, onUpdate: () => resolve({ editor, spans }) },
    );
  });
}

function coveredText(editor: LexicalEditor, id: string): string {
  return markElementsForId(editor, id).map((e) => e.textContent).join('');
}

// A blank line before the list is dropped by the serializer, and a bold-label
// bullet whose target ends the line — the exact shape of the real report.
const RAW = [
  'Intro paragraph before a list.',
  '',
  '- plain first bullet',
  '- **Bold label**: target text that runs to the very end of the bullet',
  '',
].join('\n');

const ANCHOR: Anchor = {
  targetText: 'Bold label**: target text that runs to the very end of the bullet',
  prefixContext: 'plain first bullet\n- **',
  suffixContext: '\n',
  blockType: 'paragraph',
  occurrenceIndex: 0,
  docVersion: 'x',
};
const EXPECTED_RENDERED = 'Bold label: target text that runs to the very end of the bullet';

describe('comment anchor placement: offset-table source must match the search string', () => {
  it('places the FULL target (through its last char) when the search string is the offset-table source', async () => {
    const { editor, spans } = await importWithOffsets(RAW);
    placeMarkForAnchor(editor, spans, RAW, ANCHOR, 'c1');
    expect(coveredText(editor, 'c1')).toBe(EXPECTED_RENDERED);
  });

  it('truncates the mark when the search string has drifted from the offset-table source (the bug this guards)', async () => {
    const { editor, spans } = await importWithOffsets(RAW);
    // Reproduce the real defect deterministically: the search string is 2 chars
    // SHORTER before the target than the string `spans` were parsed from (the
    // editor's non-idempotent re-serialization did exactly this in the wild).
    // `targetText` is untouched and still locates, but at an offset that no
    // longer lines up with `spans` — so the end maps short and the mark loses
    // its tail, just like the reported "last two chars missing" bullet.
    const drifted = RAW.replace('before a list', 'before list'); // drop "a " (2 chars) ahead of the target
    expect(drifted.length).toBe(RAW.length - 2);
    placeMarkForAnchor(editor, spans, drifted, ANCHOR, 'c1');
    const covered = coveredText(editor, 'c1');
    expect(covered).not.toBe(EXPECTED_RENDERED);
    expect(EXPECTED_RENDERED.startsWith(covered)).toBe(true); // a truncated prefix, not unrelated text
    expect(covered.length).toBeLessThan(EXPECTED_RENDERED.length);
  });
});

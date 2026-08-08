/**
 * Liminis #970, defect 2: an annotation's live range ended mid-syntax.
 *
 * `collectSentinelLeaves` put a mark's open/close sentinel on its first/last
 * *text leaf*, and that walk recursed into inline element children — so a mark
 * over `it [rests](https://example.com)` put its close token on the link's own
 * text, and the recovered raw-markdown range came back as `it [rests`. A host
 * comparing that against the stored `anchor.targetText` sees a difference that
 * no edit caused, and rewrites the anchor to a slice that ends inside link
 * syntax; the next refresh then compares against *that*.
 *
 * The sentinel is now hoisted outside every inline construct the mark wholly
 * covers (`collectSentinelPlacements`). These tests pin FR-011..FR-015, SC-003
 * and SC-004.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState, importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { captureAnchor, type Anchor } from '../../../annotations/anchor-model';
import { collectLiveAnchorSnapshots, placeMarksForAnchors, readAnchorFields, wrapNativeRangeInMark } from '../annotation-marks';

const REFERENCE = 'The quick brown fox jumps over the lazy dog, and then it [rests](https://example.com).\n';

let mounted: HTMLElement | null = null;
afterEach(() => {
  mounted?.remove();
  mounted = null;
});

function importWithOffsets(markdown: string): { editor: LexicalEditor; spans: OffsetSpan[] } {
  const editor = createEditor({
    namespace: 'inline-construct-ranges-test',
    nodes: editorNodes,
    onError: (error) => {
      throw error;
    },
  });
  let spans: OffsetSpan[] = [];
  editor.update(
    () => {
      spans = importMarkdownToLexicalInEditorStateWithOffsets(parseMarkdown(markdown).root);
    },
    { discrete: true },
  );
  return { editor, spans };
}

/** A mounted editor whose DOM is reconciled, for the DOM-selection capture path. */
function mountEditor(markdown: string): Promise<{ editor: LexicalEditor; element: HTMLElement }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({ namespace: 'inline-construct-ranges-test', nodes: editorNodes, onError: reject });
    const element = document.createElement('div');
    element.contentEditable = 'true';
    document.body.appendChild(element);
    mounted = element;
    editor.setRootElement(element);
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(markdown).root);
      },
      { discrete: true, onUpdate: () => resolve({ editor, element }) },
    );
  });
}

/** A native Range over the first occurrence of `text` in `element`'s rendered DOM text. */
function domRangeForText(element: HTMLElement, text: string): Range {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let concatenated = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
    concatenated += node.textContent ?? '';
  }
  const index = concatenated.indexOf(text);
  if (index === -1) throw new Error(`domRangeForText: not found: ${JSON.stringify(text)}`);

  const pointAt = (offset: number): { node: Text; offset: number } => {
    let remaining = offset;
    for (const candidate of nodes) {
      const length = candidate.textContent?.length ?? 0;
      if (remaining <= length) return { node: candidate, offset: remaining };
      remaining -= length;
    }
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.textContent?.length ?? 0 };
  };

  const start = pointAt(index);
  const end = pointAt(index + text.length);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function anchorFor(markdown: string, target: string): Anchor {
  const start = markdown.indexOf(target);
  if (start === -1) throw new Error(`anchorFor: not found: ${JSON.stringify(target)}`);
  return captureAnchor(markdown, { start, end: start + target.length }, 'v1');
}

/**
 * Places `target` (a literal raw-markdown slice) as an anchor and reads its
 * live range back out — the exact round trip a host's FR-019 refresh performs
 * on an unedited document.
 */
function recoveredSlice(markdown: string, target: string): string | null {
  const { editor, spans } = importWithOffsets(markdown);
  const placed = placeMarksForAnchors(editor, spans, markdown, [{ anchor: anchorFor(markdown, target), id: 'c1' }]);
  if (placed.length === 0) return null;
  // Byte-identity is a precondition for the offsets below to mean anything.
  expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(markdown);
  const range = collectLiveAnchorSnapshots(editor, markdown).get('c1');
  return range ? markdown.slice(range.start, range.end) : null;
}

describe('inline-construct-safe live ranges (#970 defect 2)', () => {
  // SC-003: the exact case from the issue. Before the fix this was `it [rests`.
  it('recovers a range covering a whole inline link, not a slice ending inside it', () => {
    expect(recoveredSlice(REFERENCE, 'it [rests](https://example.com)')).toBe('it [rests](https://example.com)');
  });

  it('recovers a range that is exactly one whole inline link', () => {
    const md = 'See the [project docs](https://example.com/docs) for details.\n';
    expect(recoveredSlice(md, '[project docs](https://example.com/docs)')).toBe('[project docs](https://example.com/docs)');
  });

  it('closes outside the outermost construct when constructs nest', () => {
    const md = 'The fox then [**rests**](https://example.com) quietly.\n';
    expect(recoveredSlice(md, 'then [**rests**](https://example.com)')).toBe('then [**rests**](https://example.com)');
  });

  it('keeps a link’s title in the recovered range', () => {
    const md = 'Read [the docs](https://example.com "Docs") today.\n';
    expect(recoveredSlice(md, '[the docs](https://example.com "Docs")')).toBe('[the docs](https://example.com "Docs")');
  });

  // FR-012: construct-general, not special-cased to links.
  it.each([
    ['strong', 'hello **big world** end\n', '**big world**'],
    ['emphasis', 'hello *big world* end\n', '*big world*'],
    ['strikethrough', 'hello ~~big world~~ end\n', '~~big world~~'],
    ['inline code', 'Run the `npm install` command.\n', '`npm install`'],
    ['inline math', 'The value $x^2$ matters.\n', '$x^2$'],
    ['wiki link', 'See [[Some Page|the page]] for more.\n', '[[Some Page|the page]]'],
    ['image inside a link', 'Build [![status](https://img.example/b.svg)](https://ci.example/job) is green.\n', '[![status](https://img.example/b.svg)](https://ci.example/job)'],
  ])('recovers a whole %s construct intact', (_name, md, target) => {
    expect(recoveredSlice(md, target)).toBe(target);
  });

  // A bare inline image is out of reach here for a reason unrelated to #970:
  // the mapper promotes an ImageNode out of its paragraph, so
  // `Look at ![a](u) closely.` does not round-trip inline at all and there is
  // no stable range to recover. The badge pattern above is the inline image
  // shape the editor does round-trip.

  it('extends past a construct that abuts the boundary of a wider range', () => {
    const md = 'hello **big world** end\n';
    expect(recoveredSlice(md, '**big world** end')).toBe('**big world** end');
  });

  // A list item routes only text runs, line breaks and links through the inline
  // phrasing path, so a link inside one hoists exactly like a link in a
  // paragraph — this is the shape that does reach the hoisted-token emission
  // added to `convertListItemNode`.
  it.each([
    ['bullet item', '- See [the docs](https://example.com) now\n'],
    ['ordered item', '1. See [the docs](https://example.com) now\n'],
    ['blockquote', '> See [the docs](https://example.com) now\n'],
    ['heading', '## See [the docs](https://example.com) now\n'],
    ['table cell', '| Col |\n| - |\n| See [the docs](https://example.com) now |\n'],
  ])('recovers a whole link inside a %s', (_name, md) => {
    expect(recoveredSlice(md, 'See [the docs](https://example.com) now')).toBe('See [the docs](https://example.com) now');
  });

  // FR-015: a range that touches no inline syntax behaves exactly as before.
  it('leaves a range touching no inline syntax unchanged', () => {
    expect(recoveredSlice(REFERENCE, 'brown fox jumps')).toBe('brown fox jumps');
    expect(recoveredSlice('The quick brown fox jumps.\n', 'quick brown')).toBe('quick brown');
  });

  // The Assumptions' deliberate exception, and the FORMATTING_CORPUS
  // constraint: a mark covering only *part* of a construct's text stays where
  // it is. Widening it would make the re-placed mark cover text the user never
  // selected.
  it('does not widen a mark that covers only part of a construct’s text', async () => {
    const md = 'hello **big world** end\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'big'), 'c1');

    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('big'),
      end: md.indexOf('big') + 'big'.length,
    });
  });

  // The counterpart: a DOM selection of a link's *whole* text covers the
  // construct's content in full, so its range is the whole construct (FR-011).
  // Re-placing that range snaps back inside the syntax and highlights
  // `project docs` again, so the annotation still means what the user selected.
  it('widens a DOM selection of exactly a link’s own text to the whole link', async () => {
    const md = 'See the [project docs](https://example.com/docs) for details.\n';
    const link = '[project docs](https://example.com/docs)';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'project docs'), 'c1');

    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf(link),
      end: md.indexOf(link) + link.length,
    });
  });

  // ...but a selection of only *part* of the link's text still does not widen.
  it('does not widen a DOM selection of part of a link’s text', async () => {
    const md = 'See the [project docs](https://example.com/docs) for details.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'roject doc'), 'c1');

    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('roject doc'),
      end: md.indexOf('roject doc') + 'roject doc'.length,
    });
  });
});

/**
 * SC-004: across a document containing every inline construct the editor
 * round-trips, capturing an anchor over each and immediately re-reading its
 * live range yields zero differences — so a host's FR-019 refresh pass
 * re-captures nothing on an unedited document (FR-013).
 */
describe('SC-004: an unedited document produces no spurious re-captures', () => {
  // The document deliberately contains no *aliased* wiki link (`[[a|b]]`).
  // Those are covered on their own above, but they skew every OffsetSpan after
  // them by one character, so anything placed later in the same document lands
  // one char early. That is a pre-existing defect in the parse-time offset
  // table — `parseMarkdown` reports positions into a wiki-link-*normalized*
  // string (`normalizeWikiLinks` inserts an escape per aliased link) and
  // `recordOffsetSpan` consumes them as if they were positions into the
  // caller's raw markdown. It has nothing to do with the sentinel placement
  // this suite covers, and broadening offset coverage is explicitly out of
  // #970's scope; mixing it in here would only make these assertions test the
  // wrong thing.
  const DOCUMENT =
    '# An **important** heading\n\n' +
    'A paragraph with a *notable* phrase, some `inline code`, and a [project link](https://example.com/docs) in it.\n\n' +
    'Then [![status](https://img.example/b.svg)](https://ci.example/job) and $x^2$ and ~~struck out~~ words.\n\n' +
    'A final paragraph of plain prose with nothing special about it at all.\n';

  const TARGETS = [
    '**important** heading',
    'An **important** heading',
    '*notable* phrase',
    'a *notable* phrase, some `inline code`',
    '`inline code`',
    '[project link](https://example.com/docs)',
    'and a [project link](https://example.com/docs) in it',
    '[![status](https://img.example/b.svg)](https://ci.example/job)',
    'Then [![status](https://img.example/b.svg)](https://ci.example/job) and',
    'and $x^2$ and',
    '~~struck out~~',
    '~~struck out~~ words',
    'plain prose with nothing special',
  ];

  it.each(TARGETS)('re-reads %s identically', (target) => {
    expect(recoveredSlice(DOCUMENT, target)).toBe(target);
  });

  // FR-014, first clause: no recovered boundary falls strictly inside a
  // delimiter run. Checked structurally — a boundary that split a `**`, `~~`,
  // `[[`, `](` or a backtick/dollar delimiter would show up as an unbalanced
  // slice.
  it.each(TARGETS)('recovers a well-formed slice for %s', (target) => {
    const slice = recoveredSlice(DOCUMENT, target);
    expect(slice).not.toBeNull();
    for (const [open, close] of [['[', ']'], ['(', ')']] as const) {
      expect(slice!.split(open).length).toBe(slice!.split(close).length);
    }
    for (const delimiter of ['**', '~~', '`', '$']) {
      expect(slice!.split(delimiter).length % 2).toBe(1);
    }
  });

  // The whole point, stated as the host sees it: capture from a live mark, then
  // re-place and re-read, and nothing moves.
  it.each(TARGETS)('round-trips capture → re-place → re-read for %s', (target) => {
    const { editor, spans } = importWithOffsets(DOCUMENT);
    expect(placeMarksForAnchors(editor, spans, DOCUMENT, [{ anchor: anchorFor(DOCUMENT, target), id: 'c1' }])).toEqual(['c1']);

    const fields = readAnchorFields(editor, 'c1');
    expect(fields).not.toBeNull();
    expect(fields!.targetText).toBe(target);
  });
});

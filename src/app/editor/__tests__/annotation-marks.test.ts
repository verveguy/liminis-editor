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
 * comment-anchor-marks.ts (#43): the live MarkNode-based anchor mechanism
 * that replaces comment-anchor-mapping.ts's ordinal-block-index glue.
 *
 * Mounts a real editor into a real (happy-dom) DOM so wrapNativeRangeInMark
 * can be exercised the way it will actually run — resolving a native
 * `Range` (as captured from `window.getSelection()`) to Lexical nodes via
 * `$getNearestNodeFromDOMNode`, which only works against reconciled DOM.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { $getRoot, $isElementNode, $isTextNode, createEditor, type LexicalEditor, type LexicalNode } from 'lexical';
import { $isMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState, importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { captureAnchor } from '../../../annotations/anchor-model';
import { resolveAnchor } from '../../../annotations/anchor-resolver';
import { registerMarkOverlapResolver } from '../mark-overlap-resolver';
import {
  collectLiveAnchorSnapshots,
  getMarkRects,
  hasLiveMark,
  markElementsForId,
  placeMarkForAnchor,
  readAnchorFields,
  removeMarksForAnnotation,
  removeMarksForAnnotations,
  wrapNativeRangeInMark,
} from '../annotation-marks';

let mountedElement: HTMLElement | null = null;

afterEach(() => {
  mountedElement?.remove();
  mountedElement = null;
});

/** Mounts a fresh editor into a real DOM element and imports `markdown` into it. */
function mountEditor(markdown: string): Promise<{ editor: LexicalEditor; element: HTMLElement }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({
      namespace: 'test',
      nodes: editorNodes,
      onError: (error) => reject(error),
    });
    const element = document.createElement('div');
    element.contentEditable = 'true';
    document.body.appendChild(element);
    mountedElement = element;
    editor.setRootElement(element);

    const parsed = parseMarkdown(markdown);
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parsed.root);
      },
      { discrete: true, onUpdate: () => resolve({ editor, element }) },
    );
  });
}

/** Builds a native Range covering the `occurrence`-th (0-based) match of `text` within `element`'s rendered DOM text. */
function domRangeForText(element: HTMLElement, text: string, occurrence = 0): Range {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let concatenated = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
    concatenated += node.textContent ?? '';
  }
  let idx = concatenated.indexOf(text);
  for (let seen = 0; idx !== -1 && seen < occurrence; seen++) idx = concatenated.indexOf(text, idx + 1);
  if (idx === -1) throw new Error(`domRangeForText: not found: ${JSON.stringify(text)} (occurrence ${occurrence})`);

  const pointAt = (offset: number): { node: Text; offset: number } => {
    let remaining = offset;
    for (const n of nodes) {
      const len = n.textContent?.length ?? 0;
      if (remaining <= len) return { node: n, offset: remaining };
      remaining -= len;
    }
    const last = nodes[nodes.length - 1];
    return { node: last, offset: last.textContent?.length ?? 0 };
  };

  const start = pointAt(idx);
  const end = pointAt(idx + text.length);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** The text node + offset just past the last char of `text` within `root`'s first matching text node. */
function lastText(root: HTMLElement, text: string): { node: Text; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const content = n.textContent ?? '';
    const idx = content.indexOf(text);
    if (idx !== -1) return { node: n as Text, offset: idx + text.length };
  }
  throw new Error(`lastText: not found: ${JSON.stringify(text)}`);
}

async function exportMarkdown(editor: LexicalEditor): Promise<string> {
  return stringifyMarkdown(exportLexicalToMdast(editor));
}

/** Fresh editor imported from `markdown`, plus the parse-time `OffsetSpan[]` table `placeMarkForAnchor` needs. */
function importWithOffsets(markdown: string): Promise<{ editor: LexicalEditor; spans: OffsetSpan[] }> {
  return new Promise((resolve, reject) => {
    const editor = createEditor({ namespace: 'test', nodes: editorNodes, onError: (e) => reject(e) });
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

/** The concatenated *rendered* plain text of every live MarkNode wrapping `id` — what a reviewer would actually see highlighted. */
function liveMarkRenderedText(editor: LexicalEditor, id: string): string {
  return editor.getEditorState().read(() => {
    let text = '';
    const visit = (node: LexicalNode): void => {
      if ($isMarkNode(node) && node.hasID(id)) {
        text += node.getTextContent();
        return;
      }
      if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child);
      }
    };
    visit($getRoot());
    return text;
  });
}

describe('wrapNativeRangeInMark', () => {
  it('wraps a plain-text selection and reports its markdown range', async () => {
    const md = 'The quick brown fox jumps over the lazy dog.\n';
    const { editor, element } = await mountEditor(md);
    const range = domRangeForText(element, 'brown fox');

    wrapNativeRangeInMark(editor, range, 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(true);
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('brown fox'),
      end: md.indexOf('brown fox') + 'brown fox'.length,
    });
  });

  it('wraps a selection inside a list item below other content (the ordinal-alignment defect this replaces)', async () => {
    const md = '- one\n- two\n- three with target text\n\n## After the list\n\nMore words.\n';
    const { editor, element } = await mountEditor(md);
    const range = domRangeForText(element, 'target text');

    wrapNativeRangeInMark(editor, range, 'c1');
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('target text'),
      end: md.indexOf('target text') + 'target text'.length,
    });
  });

  it('marked content still exports byte-identically (SC-002)', async () => {
    const md = 'hello **big world** end\n';
    const { editor, element } = await mountEditor(md);
    const range = domRangeForText(element, 'big');
    wrapNativeRangeInMark(editor, range, 'c1');
    expect(await exportMarkdown(editor)).toBe(md);
  });

  it('a comment spanning a heading and the following paragraph aggregates into one range', async () => {
    const md = '# A heading with words\n\nA paragraph right after it.\n';
    const { editor, element } = await mountEditor(md);

    wrapNativeRangeInMark(editor, domRangeForText(element, 'heading with words'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'paragraph right after'), 'c1');

    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('heading with words'),
      end: md.indexOf('paragraph right after') + 'paragraph right after'.length,
    });
  });

  it('captures the whole selection when the start boundary is an element node, not a fragment (issue #46)', async () => {
    // Chromium reports word-/inline-boundary selections with the *element* as
    // the container and a *child index* as the offset. Feeding that child index
    // in as a character offset is what truncated "agentic platform product" to
    // "platform product". Simulate it: start boundary = the paragraph element,
    // child index 0 (before its first text node); end boundary = a real text
    // offset at the end of "product".
    const md = 'agentic platform product ships today\n';
    const { editor, element } = await mountEditor(md);
    const paragraph = element.querySelector('p')!;
    const endText = lastText(paragraph, 'product');

    const range = document.createRange();
    range.setStart(paragraph, 0); // element container, child-index offset
    range.setEnd(endText.node, endText.offset);

    wrapNativeRangeInMark(editor, range, 'c1');
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: 0,
      end: md.indexOf('product') + 'product'.length,
    });
  });

  it('trims a selection that grazes one character into trailing whitespace (the boundary-cross flag)', async () => {
    // "Model Context Protocol " — a drag that overshoots into the space before
    // the next block would record block=null and flag on reload. The capture
    // must trim to "Model Context Protocol".
    const md = 'Uses the Model Context Protocol here.\n';
    const { editor, element } = await mountEditor(md);
    const range = domRangeForText(element, 'Model Context Protocol '); // note trailing space

    wrapNativeRangeInMark(editor, range, 'c1');
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: md.indexOf('Model Context Protocol'),
      end: md.indexOf('Model Context Protocol') + 'Model Context Protocol'.length,
    });
  });

  it('disambiguates a duplicated phrase by its own surrounding text, not the first occurrence in the document', async () => {
    const md = 'First: the target phrase appears here. Second: the target phrase appears again.\n';
    const { editor, element } = await mountEditor(md);
    const secondOccurrenceStart = md.indexOf('the target phrase', md.indexOf('the target phrase') + 1);

    wrapNativeRangeInMark(editor, domRangeForText(element, 'the target phrase', 1), 'c1');

    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual({
      start: secondOccurrenceStart,
      end: secondOccurrenceStart + 'the target phrase'.length,
    });
  });
});

describe('removeMarksForAnnotation', () => {
  it('unwraps the mark and restores byte-identical export', async () => {
    const md = 'hello **big world** end\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'big'), 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(true);

    removeMarksForAnnotation(editor, 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(false);
    expect(await exportMarkdown(editor)).toBe(md);
  });

  // Retraction is batched for the same reason placement is: a host dropping a
  // set of live annotations at once ("resolve all comments", or an
  // offsetsVersion bump that takes a batch out of the marker targets) would
  // otherwise force one synchronous Lexical reconciliation per id (review
  // finding, @handarbeit-pruefer).
  it('removes many ids in a single editor.update()', async () => {
    const md = 'one two three four five\n';
    const { editor, element } = await mountEditor(md);
    for (const [text, id] of [['two', 'c1'], ['three', 'c2'], ['four', 'c3']] as const) {
      wrapNativeRangeInMark(editor, domRangeForText(element, text), id);
    }
    expect(['c1', 'c2', 'c3'].every((id) => hasLiveMark(editor, id))).toBe(true);

    let updates = 0;
    const unregister = editor.registerUpdateListener(() => {
      updates++;
    });
    removeMarksForAnnotations(editor, ['c1', 'c2', 'c3']);
    unregister();

    expect(updates).toBe(1);
    expect(['c1', 'c2', 'c3'].some((id) => hasLiveMark(editor, id))).toBe(false);
    // ...and the document is byte-identical again, i.e. the marks really were
    // unwrapped rather than merely stripped of their ids.
    expect(await exportMarkdown(editor)).toBe(md);
  });

  it('leaves ids outside the batch alone', async () => {
    const md = 'alpha beta gamma\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'alpha'), 'keep');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'gamma'), 'drop');

    removeMarksForAnnotations(editor, ['drop']);

    expect(hasLiveMark(editor, 'drop')).toBe(false);
    expect(hasLiveMark(editor, 'keep')).toBe(true);
  });

  it('unwraps a mark only once both of its overlapping ids are in one batch', async () => {
    const md = 'shared text between two comments\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'shared text'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'shared text'), 'c2');

    removeMarksForAnnotations(editor, ['c1', 'c2']);

    expect(hasLiveMark(editor, 'c1')).toBe(false);
    expect(hasLiveMark(editor, 'c2')).toBe(false);
    expect(await exportMarkdown(editor)).toBe(md);
  });

  it('removing one of two overlapping comment ids leaves the other mark intact', async () => {
    const md = 'shared text between two comments\n';
    const { editor, element } = await mountEditor(md);
    const range1 = domRangeForText(element, 'shared text');
    wrapNativeRangeInMark(editor, range1, 'c1');
    // Re-locate after the first wrap split/wrapped the text node.
    const range2 = domRangeForText(element, 'shared text');
    wrapNativeRangeInMark(editor, range2, 'c2');

    removeMarksForAnnotation(editor, 'c1');
    expect(hasLiveMark(editor, 'c1')).toBe(false);
    expect(hasLiveMark(editor, 'c2')).toBe(true);
  });
});

describe('placeMarkForAnchor (read pathway)', () => {
  it('places a mark for an anchor whose target is unchanged, with no fuzzy matching (US3/SC-003)', async () => {
    const md = '- one\n- two with a target passage\n- three\n';
    const { editor, spans } = await importWithOffsets(md);
    const range = { start: md.indexOf('target passage'), end: md.indexOf('target passage') + 'target passage'.length };
    const anchor = captureAnchor(md, range, 'v1');

    const placed = placeMarkForAnchor(editor, spans, md, anchor, 'c1');
    expect(placed).toBe(true);
    expect(hasLiveMark(editor, 'c1')).toBe(true);
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual(range);
  });

  it('is idempotent — placing twice for the same id is a no-op the second time', async () => {
    const md = 'a paragraph with a target passage in it\n';
    const { editor, spans } = await importWithOffsets(md);
    const range = { start: md.indexOf('target passage'), end: md.indexOf('target passage') + 'target passage'.length };
    const anchor = captureAnchor(md, range, 'v1');

    expect(placeMarkForAnchor(editor, spans, md, anchor, 'c1')).toBe(true);
    expect(placeMarkForAnchor(editor, spans, md, anchor, 'c1')).toBe(true);
    expect(collectLiveAnchorSnapshots(editor, md).get('c1')).toEqual(range);
  });

  it('returns false and places no mark when the target text is gone (orphaned, panel-only per FR-008)', async () => {
    const md = 'a paragraph with no matching text\n';
    const { editor, spans } = await importWithOffsets(md);
    const anchor = captureAnchor('a paragraph with a target passage in it\n', { start: 21, end: 35 }, 'v1');

    const placed = placeMarkForAnchor(editor, spans, md, anchor, 'c1');
    expect(placed).toBe(false);
    expect(hasLiveMark(editor, 'c1')).toBe(false);
  });

  it('resolves a target whose boundaries coincide with formatting syntax to the rendered text (FR-005)', async () => {
    // A hand-rolled anchor whose targetText includes the enclosing "**" —
    // exactly the shape pointAtMarkdownOffset's boundary-snap (#47) exists
    // for: located.start lands *on* the opening delimiter (a gap the parse-time
    // OffsetSpan table never covers) and located.end lands just past the
    // closing one. Both must snap inward to the rendered "quick", not fail.
    const md = 'The **quick** fox jumps.\n';
    const { editor, spans } = await importWithOffsets(md);
    const anchor = captureAnchor(md, { start: md.indexOf('**quick**'), end: md.indexOf('**quick**') + '**quick**'.length }, 'v1');
    expect(anchor.targetText).toBe('**quick**');

    const placed = placeMarkForAnchor(editor, spans, md, anchor, 'c1');
    expect(placed).toBe(true);
    expect(liveMarkRenderedText(editor, 'c1')).toBe('quick');
  });
});

describe('collectLiveAnchorSnapshots (FR-006)', () => {
  it('reports the current live range for every commented passage, unaffected by unrelated edits', async () => {
    const md = 'Passage A is here. Passage B is over there.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'Passage A'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'Passage B'), 'c2');

    const snapshots = collectLiveAnchorSnapshots(editor, md);
    expect(snapshots.get('c1')).toEqual({ start: md.indexOf('Passage A'), end: md.indexOf('Passage A') + 'Passage A'.length });
    expect(snapshots.get('c2')).toEqual({ start: md.indexOf('Passage B'), end: md.indexOf('Passage B') + 'Passage B'.length });
  });

  it('omits comments with no live mark', async () => {
    const md = 'just some text\n';
    const { editor } = await mountEditor(md);
    expect(collectLiveAnchorSnapshots(editor, md).size).toBe(0);
  });

  it('omits a comment rather than trusting a stale markdownText that no longer matches the live tree (review finding)', async () => {
    // collectLiveAnchorSnapshots takes markdownText as a caller-supplied
    // parameter rather than deriving it fresh — locateLiveMarkdownRange's
    // offset math is only valid when that string is actually a plain export
    // of the same live state its sentinel-derived range was computed
    // against. A caller passing a drifted string (e.g. a ref that lagged
    // behind an edit) must get nothing back for the affected id, never a
    // range that silently points at the wrong substring.
    const md = 'Passage A is here.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'Passage A'), 'c1');

    const staleMarkdown = 'Something else entirely, unrelated to the live tree.\n';
    expect(collectLiveAnchorSnapshots(editor, staleMarkdown).get('c1')).toBeUndefined();
  });
});

/**
 * Stubs `getBoundingClientRect` on every element in `elements` with a distinct,
 * recognizable rect — the established per-element idiom (`host-plugins.test.tsx`),
 * since jsdom/happy-dom always report a zeroed rect otherwise. Each element's
 * stub always returns the *same* rect object, so two calls compare equal by
 * reference (`toJSON` is a fresh closure per element, but stable across calls).
 */
function stubRects(elements: HTMLElement[]): void {
  elements.forEach((element, index) => {
    const rect = { x: index * 10, y: 0, top: 0, left: index * 10, right: index * 10 + 5, bottom: 5, width: 5, height: 5, toJSON: () => ({}) } as DOMRect;
    element.getBoundingClientRect = () => rect;
  });
}

describe('getMarkRects (#73)', () => {
  it("matches the mark element's own getBoundingClientRect for a single-MarkNode annotation", async () => {
    const md = 'hello big world end\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'big'), 'c1');
    const markElements = markElementsForId(editor, 'c1');
    stubRects(markElements);

    const rects = getMarkRects(editor, ['c1']);
    expect(rects.get('c1')).toEqual([markElements[0].getBoundingClientRect()]);
  });

  it('returns one rect per constituent MarkNode for a multi-block annotation, in document order', async () => {
    const md = '# Heading\n\nA paragraph below it.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'Heading'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'paragraph'), 'c1');
    const markElements = markElementsForId(editor, 'c1');
    expect(markElements).toHaveLength(2);
    stubRects(markElements);

    const rects = getMarkRects(editor, ['c1']);
    expect(rects.get('c1')).toEqual(markElements.map((el) => el.getBoundingClientRect()));
  });

  it('does not throw and simply omits an id with no currently live mark', async () => {
    const md = 'just some text\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'some'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'text'), 'removed');
    removeMarksForAnnotation(editor, 'removed');

    const rects = getMarkRects(editor, ['c1', 'never-created', 'removed']);
    expect([...rects.keys()]).toEqual(['c1']);
    expect(rects.has('never-created')).toBe(false);
    expect(rects.has('removed')).toBe(false);
  });

  it('returns geometry for every live annotation when ids is omitted', async () => {
    const md = 'alpha beta gamma\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'alpha'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'gamma'), 'c2');

    const rects = getMarkRects(editor);
    expect([...rects.keys()].sort()).toEqual(['c1', 'c2']);
  });

  it('reports the same rect under each id for two annotations sharing one MarkNode', async () => {
    const md = 'shared text between two comments\n';
    const { editor, element } = await mountEditor(md);
    // Unnests overlapping marks onto one shared MarkNode with both ids — the
    // same mechanism AnnotationSurface registers via MarkOverlapResolverPlugin;
    // without it, two wraps over the same range simply nest.
    registerMarkOverlapResolver(editor);
    const range1 = domRangeForText(element, 'shared text');
    wrapNativeRangeInMark(editor, range1, 'c1');
    // Re-locate after the first wrap split the text node.
    const range2 = domRangeForText(element, 'shared text');
    wrapNativeRangeInMark(editor, range2, 'c2');
    const markElements = markElementsForId(editor, 'c1');
    expect(markElements).toEqual(markElementsForId(editor, 'c2'));
    stubRects(markElements);

    const rects = getMarkRects(editor, ['c1', 'c2']);
    expect(rects.get('c1')).toEqual(rects.get('c2'));
  });

  it('reflects current DOM state rather than a value cached from an earlier call (FR-004)', async () => {
    const md = 'hello world end\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'world'), 'c1');
    const [markElement] = markElementsForId(editor, 'c1');

    markElement.getBoundingClientRect = () => ({ x: 1, y: 1, top: 1, left: 1, right: 6, bottom: 6, width: 5, height: 5, toJSON: () => ({}) });
    expect(getMarkRects(editor, ['c1']).get('c1')![0].x).toBe(1);

    markElement.getBoundingClientRect = () => ({ x: 2, y: 2, top: 2, left: 2, right: 7, bottom: 7, width: 5, height: 5, toJSON: () => ({}) });
    expect(getMarkRects(editor, ['c1']).get('c1')![0].x).toBe(2);
  });
});

describe('a comment stays glued to its target through edits elsewhere (US1)', () => {
  it('recovers the shifted range after text is inserted inside a list item above the target', async () => {
    const md = '- one\n- two\n- three\n\n## After the list\n\nA target passage down here.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'target passage'), 'c1');

    // Simulate a keystroke elsewhere: lengthen the first list item's text —
    // exactly the block-model divergence (list item vs. Lexical's single
    // list block) the ordinal-alignment defect this replaces used to trip on.
    editor.update(
      () => {
        for (const textNode of $getRoot().getAllTextNodes()) {
          if (textNode.getTextContent() === 'one') {
            textNode.setTextContent('one (expanded)');
            break;
          }
        }
      },
      { discrete: true },
    );

    const newMarkdown = stringifyMarkdown(exportLexicalToMdast(editor));
    expect(newMarkdown).toContain('one (expanded)');
    expect(newMarkdown).not.toBe(md); // sanity: the edit actually landed

    const snapshot = collectLiveAnchorSnapshots(editor, newMarkdown).get('c1');
    expect(snapshot).toEqual({
      start: newMarkdown.indexOf('target passage'),
      end: newMarkdown.indexOf('target passage') + 'target passage'.length,
    });
    expect(newMarkdown.slice(snapshot!.start, snapshot!.end)).toBe('target passage');
  });

  it("leaves the mark's own text untouched by an edit immediately adjacent to it", async () => {
    const md = 'Before text. Target phrase. After text.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'Target phrase'), 'c1');

    editor.update(
      () => {
        for (const textNode of $getRoot().getAllTextNodes()) {
          if ($isTextNode(textNode) && textNode.getTextContent().startsWith('Before text')) {
            textNode.setTextContent(textNode.getTextContent() + ' Extra sentence inserted.');
            break;
          }
        }
      },
      { discrete: true },
    );

    const newMarkdown = stringifyMarkdown(exportLexicalToMdast(editor));
    const snapshot = collectLiveAnchorSnapshots(editor, newMarkdown).get('c1');
    expect(newMarkdown.slice(snapshot!.start, snapshot!.end)).toBe('Target phrase');
  });
});

/**
 * #47's regression corpus: a target that contains or abuts inline formatting
 * must behave exactly like plain prose — captured faithfully (US2), and
 * re-attached exactly on an unchanged reopen (US1), never spuriously
 * flagged/orphaned (US4) — across bold/italic/inline-code/link, whether the
 * target is the whole formatted run or crosses its boundary into plain text
 * (SC-001/SC-002/SC-003).
 */
const FORMATTING_CORPUS: { name: string; md: string; target: string }[] = [
  { name: 'plain prose (no formatting)', md: 'The quick brown fox jumps over the lazy dog.\n', target: 'brown fox' },
  { name: 'exactly a whole bold run', md: 'hello **big world** end\n', target: 'big world' },
  { name: 'subset entirely inside a bold run', md: 'hello **big world** end\n', target: 'big' },
  { name: 'bold run crossing into following plain text', md: 'hello **big world** end\n', target: 'world end' },
  { name: 'exactly a whole italic run', md: 'hello *big world* end\n', target: 'big world' },
  { name: 'italic run crossing into following plain text', md: 'hello *big world* end\n', target: 'world end' },
  { name: 'exactly a whole inline code span', md: 'Run the `npm install` command.\n', target: 'npm install' },
  { name: 'inline code crossing into following plain text', md: 'Run the `npm install` command.\n', target: 'install command' },
  { name: 'exactly a whole link text', md: 'See the [project docs](https://example.com/docs) for details.\n', target: 'project docs' },
  { name: 'link text crossing into following plain text', md: 'See the [project docs](https://example.com/docs) for details.\n', target: 'docs for' },
  { name: 'an entire heading block containing bold', md: '# An **important** heading\n\nSome intro text.\n', target: 'An important heading' },
];

describe('formatting-aware capture and re-attach (#47)', () => {
  it.each(FORMATTING_CORPUS)('captures, preserves byte-identity, and re-attaches exactly: $name', async ({ md, target }) => {
    // Capture: simulate selecting `target` in the live editor and adding a comment.
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, target), 'c1');

    // FR-003/SC-002: a live mark must never change what's written to disk.
    expect(await exportMarkdown(editor)).toBe(md);

    // US2/FR-001: the stored target must faithfully reproduce the exact
    // rendered selection once resolved back onto a document — checked below
    // via the reopened mark's own rendered text, not by asserting a literal
    // string shape for targetText itself (which is a raw-markdown slice, and
    // may legitimately carry formatting syntax at/within its boundaries).
    const anchorFields = readAnchorFields(editor, 'c1');
    expect(anchorFields).not.toBeNull();
    const anchor = { ...anchorFields!, docVersion: 'v1' };

    // FR-003/SC-002: removing the comment must restore byte-identical markdown.
    removeMarksForAnnotation(editor, 'c1');
    expect(await exportMarkdown(editor)).toBe(md);

    // Reopen unchanged: fresh import, then place the mark from the durable anchor.
    const { editor: editor2, spans } = await importWithOffsets(md);
    const placed = placeMarkForAnchor(editor2, spans, md, anchor, 'c1');
    expect(placed).toBe(true);

    // US1 AC1/AC2: the highlight covers exactly the originally-selected rendered text.
    expect(liveMarkRenderedText(editor2, 'c1')).toBe(target);

    // FR-002/FR-004/US4/SC-001/SC-003: resolving the (unchanged) anchor
    // against the same document must never be flagged/orphaned solely
    // because the target contains or abuts formatting.
    const resolution = await resolveAnchor(anchor, md, 'v1');
    expect(resolution.outcome).toBe('unchanged');
  });

  it('re-attaches a multi-block target spanning a heading and paragraph, both containing formatting (US3)', async () => {
    const md = '# A **bold** heading\n\nA paragraph with *italic* words right after it.\n';
    const { editor, element } = await mountEditor(md);

    wrapNativeRangeInMark(editor, domRangeForText(element, 'bold heading'), 'c1');
    wrapNativeRangeInMark(editor, domRangeForText(element, 'paragraph with italic words'), 'c1');

    expect(await exportMarkdown(editor)).toBe(md);

    const anchorFields = readAnchorFields(editor, 'c1');
    expect(anchorFields).not.toBeNull();
    expect(anchorFields!.blockType).toBeNull(); // spans more than one leaf block
    const anchor = { ...anchorFields!, docVersion: 'v1' };

    removeMarksForAnnotation(editor, 'c1');
    expect(await exportMarkdown(editor)).toBe(md);

    // Re-placing a *multi-block* anchor in one $wrapSelectionInMarkNode call
    // (vs. the write side's two separate per-block calls above) is a
    // pre-existing placeMarkForAnchor limitation, reproducible identically
    // for a plain-text multi-block anchor — unrelated to and out of scope
    // for #47 (which only touches capture and the single-block OffsetSpan
    // boundary-snap). What #47 must get right here is the *capture* domain
    // and the resolver's classification, asserted below.
    const resolution = await resolveAnchor(anchor, md, 'v1');
    expect(resolution.outcome).toBe('unchanged');
  });

  it('re-anchors a comment on formatted text after an edit elsewhere, exactly as it does for plain prose (US1, FR-006 closes the silent-failure gap)', async () => {
    const md = 'Intro line.\n\nA paragraph mentioning the **quick brown** fox.\n';
    const { editor, element } = await mountEditor(md);
    // "brown fox" starts inside the bold run and crosses into the following
    // plain text — before #47, the rendered text "brown fox" is not a raw-
    // markdown substring of "...brown** fox..." (the closing "**" sits in the
    // middle), so this is exactly the shape that used to fail.
    wrapNativeRangeInMark(editor, domRangeForText(element, 'brown fox'), 'c1');

    // Edit elsewhere — unrelated to the comment, mirrors the existing
    // plain-prose FR-006 test above.
    editor.update(
      () => {
        for (const textNode of $getRoot().getAllTextNodes()) {
          if (textNode.getTextContent() === 'Intro line.') {
            textNode.setTextContent('Intro line, now longer.');
            break;
          }
        }
      },
      { discrete: true },
    );

    const newMarkdown = stringifyMarkdown(exportLexicalToMdast(editor));
    expect(newMarkdown).not.toBe(md); // sanity: the edit actually landed

    // Before #47, locateLiveMarkRange searched for the mark's *rendered* text
    // ("brown fox") as a raw-markdown substring — not found inside
    // "...brown** fox..." once the closing "**" sits in the middle, so this
    // snapshot would silently come back empty.
    const snapshot = collectLiveAnchorSnapshots(editor, newMarkdown).get('c1');
    expect(snapshot).toBeDefined();
    expect(newMarkdown.slice(snapshot!.start, snapshot!.end)).toBe('brown** fox');

    const anchor = captureAnchor(newMarkdown, snapshot!, 'v2');
    const resolution = await resolveAnchor(anchor, newMarkdown, 'v2');
    expect(resolution.outcome).toBe('unchanged');
  });

  it('flags none of several formatted-text comments when the document is reopened with no edits (US4/SC-003)', async () => {
    const md =
      '# An **important** heading\n\n' +
      'A paragraph with a *notable* phrase and some `inline code` too.\n\n' +
      'See the [project docs](https://example.com/docs) for more.\n';
    const { editor, element } = await mountEditor(md);

    const targets: [string, string][] = [
      ['c1', 'important heading'],
      ['c2', 'notable phrase'],
      ['c3', 'inline code'],
      ['c4', 'project docs'],
    ];
    for (const [id, target] of targets) {
      wrapNativeRangeInMark(editor, domRangeForText(element, target), id);
    }
    expect(await exportMarkdown(editor)).toBe(md);

    for (const [id] of targets) {
      const anchorFields = readAnchorFields(editor, id);
      expect(anchorFields).not.toBeNull();
      const anchor = { ...anchorFields!, docVersion: 'v1' };
      const resolution = await resolveAnchor(anchor, md, 'v1');
      expect(resolution.outcome).not.toBe('flagged');
      expect(resolution.outcome).not.toBe('orphaned');
      expect(resolution.outcome).toBe('unchanged');
    }
  });

  it('captures a comment on text inside a fenced code block, preserving byte-identity (FR-001/FR-003)', async () => {
    // A fenced code block is mark-transparent-but-unaugmented territory the
    // formatting corpus above never exercises. Before this fix,
    // convertCodeNode built its mdast value from node.getTextContent()
    // directly rather than effectiveChildren()/sentinelAugmentedText(), so
    // the annotated-serialize harvest could never find its sentinel tokens
    // inside a code block — readAnchorFields always returned null here,
    // silently downgrading the comment to document-level instead of
    // capturing the selected line.
    const md = '# Setup\n\n```\nfirst line\nsecond target line\nthird line\n```\n\nDone.\n';
    const { editor, element } = await mountEditor(md);
    wrapNativeRangeInMark(editor, domRangeForText(element, 'second target line'), 'c1');

    expect(await exportMarkdown(editor)).toBe(md);

    const anchorFields = readAnchorFields(editor, 'c1');
    expect(anchorFields).not.toBeNull();
    expect(anchorFields!.targetText).toBe('second target line');

    removeMarksForAnnotation(editor, 'c1');
    expect(await exportMarkdown(editor)).toBe(md);
  });

  it('never mis-places a mark across an untracked gap (e.g. a fenced code block) — declines rather than wrapping the whole gap (FR-002)', async () => {
    // pointAtMarkdownOffset's boundary-snap is designed for narrow
    // formatting-delimiter gaps, where snapping the start forward and the
    // end backward land on the SAME adjacent span. A fenced code block's
    // content has no OffsetSpan coverage at all (a much wider, unrelated
    // gap) — snapping both sides independently can land on two DIFFERENT,
    // ordered-backwards spans (start snaps past the block, end snaps before
    // it), which would make $wrapSelectionInMarkNode wrap everything
    // between them: the entire code block, not the intended line.
    const md = 'Intro paragraph.\n\n```\nfirst line\nsecond target line\nthird line\n```\n\nOutro paragraph.\n';
    const { editor, spans } = await importWithOffsets(md);

    const target = 'second target line';
    const start = md.indexOf(target);
    const anchor = captureAnchor(md, { start, end: start + target.length }, 'v1');

    const placed = placeMarkForAnchor(editor, spans, md, anchor, 'c1');
    expect(placed).toBe(false);
    expect(hasLiveMark(editor, 'c1')).toBe(false);
  });
});

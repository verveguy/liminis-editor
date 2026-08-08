/**
 * Liminis #970, defect 1: a batch containing overlapping anchors placed only
 * one of them.
 *
 * `placeMarksForAnchors` used to order its entries back to front, because
 * placing a mark splits the `TextNode` it lands in while the parse-time
 * `OffsetSpan[]` still describes the unsplit parse. That keeps every *disjoint*
 * entry's span valid, but for ranges that overlap, nest or coincide the later
 * placement splits a node an *earlier* entry still needs — so that entry's
 * offsets ran past the end of what its key now held and the placement declined,
 * silently, leaving an annotation with no marker and no way to reach it from
 * the document.
 *
 * Placement is now resolved against the pristine tree into *absolute* text
 * offsets (marking changes no text, so they survive every split) and applied
 * against the live tree, which makes each entry independent of every other.
 * These tests pin that: FR-001..FR-010, SC-001, SC-002, SC-005.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorStateWithOffsets, type OffsetSpan } from '../../mapper/mdastToLexical';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { captureAnchor, type Anchor } from '../../../annotations/anchor-model';
import { hasLiveMark, markElementsForId, placeMarksForAnchors, removeMarksForAnnotation } from '../annotation-marks';
import { registerMarkOverlapResolver } from '../mark-overlap-resolver';

/** The issue's reference paragraph — one prose run plus an inline link. */
const REFERENCE = 'The quick brown fox jumps over the lazy dog, and then it [rests](https://example.com).\n';

let mounted: HTMLElement | null = null;
afterEach(() => {
  mounted?.remove();
  mounted = null;
});

function mount(markdown: string, options: { unnestOverlaps?: boolean } = {}): { editor: LexicalEditor; spans: OffsetSpan[]; element: HTMLElement } {
  const element = document.createElement('div');
  element.contentEditable = 'true';
  document.body.appendChild(element);
  mounted = element;

  const editor = createEditor({
    namespace: 'overlapping-placement-test',
    nodes: editorNodes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(element);
  if (options.unnestOverlaps) registerMarkOverlapResolver(editor);

  let spans: OffsetSpan[] = [];
  editor.update(
    () => {
      spans = importMarkdownToLexicalInEditorStateWithOffsets(parseMarkdown(markdown).root);
    },
    { discrete: true },
  );

  return { editor, spans, element };
}

/** An anchor over the (0-based) `occurrence`-th literal occurrence of `target` in `markdown`. */
function anchorFor(markdown: string, target: string, occurrence = 0): Anchor {
  let start = markdown.indexOf(target);
  for (let seen = 0; start !== -1 && seen < occurrence; seen++) start = markdown.indexOf(target, start + 1);
  if (start === -1) throw new Error(`anchorFor: not found: ${JSON.stringify(target)}`);
  return captureAnchor(markdown, { start, end: start + target.length }, 'v1');
}

/** The rendered text every `<mark>` element carrying `id` covers, concatenated in document order. */
function coveredText(editor: LexicalEditor, id: string): string {
  return markElementsForId(editor, id).map((element) => element.textContent ?? '').join('');
}

/** Every permutation of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) result.push([items[i], ...tail]);
  }
  return result;
}

describe('overlapping annotation placement (#970 defect 1)', () => {
  // SC-001: the exact pair from the issue. Both used to be reported by
  // `placeMarksForAnchors`'s own return value as a single id.
  it('places both marks for a partially overlapping (crossing) pair', () => {
    const { editor, spans } = mount(REFERENCE);
    const entries = [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'fox jumps over the lazy dog, and then it'), id: 'overlapping' },
    ];

    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['outer', 'overlapping']);
    expect(hasLiveMark(editor, 'outer')).toBe(true);
    expect(hasLiveMark(editor, 'overlapping')).toBe(true);
    expect(coveredText(editor, 'outer')).toBe('quick brown fox jumps over the lazy dog');
    expect(coveredText(editor, 'overlapping')).toBe('fox jumps over the lazy dog, and then it');
  });

  // SC-001, second half: strict nesting failed too, so this was never only a
  // crossing-ranges problem.
  it('places both marks for a strictly nested pair', () => {
    const { editor, spans } = mount(REFERENCE);
    const entries = [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
    ];

    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['outer', 'inner']);
    expect(coveredText(editor, 'outer')).toBe('quick brown fox jumps over the lazy dog');
    expect(coveredText(editor, 'inner')).toBe('brown fox');
  });

  it('places both marks when one range is identical to the other', () => {
    const { editor, spans } = mount(REFERENCE);
    const entries = [
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'a' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'b' },
    ];

    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['a', 'b']);
    expect(coveredText(editor, 'a')).toBe('brown fox');
    expect(coveredText(editor, 'b')).toBe('brown fox');
  });

  // FR-002: the set of ids placed must not depend on caller ordering.
  it.each([
    ['crossing', ['quick brown fox jumps over the lazy dog', 'fox jumps over the lazy dog, and then it']],
    ['nested', ['quick brown fox jumps over the lazy dog', 'brown fox']],
    ['identical', ['brown fox', 'brown fox']],
  ] as const)('is order-independent for a %s pair', (_name, targets) => {
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const { editor, spans } = mount(REFERENCE);
      const entries = order.map((index) => ({ anchor: anchorFor(REFERENCE, targets[index]), id: `id${index}` }));
      const placed = placeMarksForAnchors(editor, spans, REFERENCE, entries);
      expect([...placed].sort()).toEqual(['id0', 'id1']);
      for (const index of order) expect(coveredText(editor, `id${index}`)).toBe(targets[index]);
      mounted?.remove();
      mounted = null;
    }
  });

  // SC-002: three mutually overlapping annotations, every ordering.
  it('places all three marks of a mutually overlapping set, in every ordering', () => {
    const targets = {
      a: 'The quick brown fox',
      b: 'brown fox jumps over',
      c: 'fox jumps over the lazy dog',
    } as const;

    for (const order of permutations(['a', 'b', 'c'] as const)) {
      const { editor, spans } = mount(REFERENCE);
      const entries = order.map((id) => ({ anchor: anchorFor(REFERENCE, targets[id]), id }));

      const placed = placeMarksForAnchors(editor, spans, REFERENCE, entries);
      expect([...placed].sort()).toEqual(['a', 'b', 'c']);
      for (const id of order) expect(coveredText(editor, id)).toBe(targets[id]);

      mounted?.remove();
      mounted = null;
    }
  });

  it('places overlapping anchors that span a heading and the paragraph after it', () => {
    const md = '# A heading with words\n\nA paragraph right after it.\n';
    const { editor, spans } = mount(md);
    const entries = [
      { anchor: anchorFor(md, 'with words'), id: 'heading-only' },
      { anchor: anchorFor(md, 'words'), id: 'nested-in-heading' },
      { anchor: anchorFor(md, 'A paragraph right'), id: 'paragraph-only' },
    ];

    expect(placeMarksForAnchors(editor, spans, md, entries)).toEqual(['heading-only', 'nested-in-heading', 'paragraph-only']);
    expect(coveredText(editor, 'heading-only')).toBe('with words');
    expect(coveredText(editor, 'nested-in-heading')).toBe('words');
    expect(coveredText(editor, 'paragraph-only')).toBe('A paragraph right');
  });

  it('still places adjacent-but-disjoint ranges that abut at exactly one offset', () => {
    const md = 'alpha beta gamma delta\n';
    const { editor, spans } = mount(md);
    const entries = [
      { anchor: anchorFor(md, 'alpha beta'), id: 'left' },
      { anchor: anchorFor(md, ' gamma delta'), id: 'right' },
    ];

    expect(placeMarksForAnchors(editor, spans, md, entries)).toEqual(['left', 'right']);
    expect(coveredText(editor, 'left')).toBe('alpha beta');
    expect(coveredText(editor, 'right')).toBe(' gamma delta');
  });

  // FR-003: one entry declining must not poison its siblings.
  it('declines an unlocatable anchor without preventing the rest of its batch', () => {
    const { editor, spans } = mount(REFERENCE);
    const gone = captureAnchor('a document that no longer exists at all\n', { start: 2, end: 10 }, 'v1');
    const entries = [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: gone, id: 'orphan' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
    ];

    expect(() => placeMarksForAnchors(editor, spans, REFERENCE, entries)).not.toThrow();
    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['outer', 'inner']);
    expect(hasLiveMark(editor, 'orphan')).toBe(false);
  });

  // FR-007: re-placing an id that already has a live mark changes nothing.
  it('is idempotent for an overlapping batch', () => {
    const { editor, spans, element } = mount(REFERENCE);
    const entries = [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
    ];

    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['outer', 'inner']);
    const markCount = element.querySelectorAll('mark').length;

    expect(placeMarksForAnchors(editor, spans, REFERENCE, entries)).toEqual(['outer', 'inner']);
    expect(element.querySelectorAll('mark').length).toBe(markCount);
  });

  // FR-009: still exactly one reconciliation for the whole batch, now checked
  // with an *overlapping* batch rather than only a disjoint one.
  it('places an overlapping batch in a single editor update', () => {
    const { editor, spans } = mount(REFERENCE);
    const entries = [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'fox jumps over the lazy dog, and then it'), id: 'overlapping' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
    ];

    let updates = 0;
    const unregister = editor.registerUpdateListener(() => {
      updates++;
    });
    const placed = placeMarksForAnchors(editor, spans, REFERENCE, entries);
    unregister();

    // FR-010: reported in caller order.
    expect(placed).toEqual(['outer', 'overlapping', 'inner']);
    expect(updates).toBe(1);
  });

  // FR-008/SC-005: marks stay invisible to content (ADR-003).
  it('serializes byte-identically after placing overlapping marks', () => {
    const { editor, spans } = mount(REFERENCE);
    placeMarksForAnchors(editor, spans, REFERENCE, [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'fox jumps over the lazy dog, and then it'), id: 'overlapping' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
      { anchor: anchorFor(REFERENCE, 'it [rests](https://example.com)'), id: 'over-link' },
    ]);

    expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(REFERENCE);
  });

  it('places an anchor whose target is exactly a whole inline link', () => {
    const md = 'See the [project docs](https://example.com/docs) for details.\n';
    const { editor, spans } = mount(md);

    expect(placeMarksForAnchors(editor, spans, md, [{ anchor: anchorFor(md, '[project docs](https://example.com/docs)'), id: 'c1' }])).toEqual(['c1']);
    expect(coveredText(editor, 'c1')).toBe('project docs');
    expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(md);
  });
});

/**
 * FR-005/FR-006: `$wrapSelectionInMarkNode` nests a MarkNode inside an existing
 * one rather than merging ids, so the shared region of two overlapping
 * annotations resolved to only the inner id. `registerMarkOverlapResolver`
 * un-nests those into id-unioned siblings — which is the shape
 * `AnnotationMarkerPlugin` already assumes.
 */
describe('registerMarkOverlapResolver (#970 FR-005/FR-006)', () => {
  const CROSSING = [
    { target: 'quick brown fox jumps over the lazy dog', id: 'outer' },
    { target: 'fox jumps over the lazy dog, and then it', id: 'overlapping' },
  ] as const;

  function placeCrossingPair(): { editor: LexicalEditor; element: HTMLElement } {
    const { editor, spans, element } = mount(REFERENCE, { unnestOverlaps: true });
    placeMarksForAnchors(
      editor,
      spans,
      REFERENCE,
      CROSSING.map(({ target, id }) => ({ anchor: anchorFor(REFERENCE, target), id })),
    );
    return { editor, element };
  }

  it('leaves no mark nested inside another', () => {
    const { element } = placeCrossingPair();
    expect(element.querySelectorAll('mark mark').length).toBe(0);
  });

  // FR-005: a click or hover on the shared region must resolve to both ids.
  it('attributes the overlapping region to both ids on one shared element', () => {
    const { editor } = placeCrossingPair();
    const outerElements = new Set(markElementsForId(editor, 'outer'));
    const shared = markElementsForId(editor, 'overlapping').filter((element) => outerElements.has(element));

    expect(shared.length).toBe(1);
    expect(shared[0].textContent).toBe('fox jumps over the lazy dog');
  });

  it('still reports each id’s full coverage across its sibling marks', () => {
    const { editor } = placeCrossingPair();
    expect(coveredText(editor, 'outer')).toBe('quick brown fox jumps over the lazy dog');
    expect(coveredText(editor, 'overlapping')).toBe('fox jumps over the lazy dog, and then it');
  });

  // FR-006: removing one annotation leaves the other's coverage over the
  // shared region intact — the shared mark keeps its remaining id rather than
  // being unwrapped.
  it('keeps the survivor’s coverage intact when one of the pair is removed', () => {
    const { editor } = placeCrossingPair();
    removeMarksForAnnotation(editor, 'overlapping');

    expect(hasLiveMark(editor, 'overlapping')).toBe(false);
    expect(coveredText(editor, 'outer')).toBe('quick brown fox jumps over the lazy dog');
    expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(REFERENCE);
  });

  it('un-nests a strictly nested pair into three sibling marks', () => {
    const { editor, spans, element } = mount(REFERENCE, { unnestOverlaps: true });
    placeMarksForAnchors(editor, spans, REFERENCE, [
      { anchor: anchorFor(REFERENCE, 'quick brown fox jumps over the lazy dog'), id: 'outer' },
      { anchor: anchorFor(REFERENCE, 'brown fox'), id: 'inner' },
    ]);

    expect(element.querySelectorAll('mark mark').length).toBe(0);
    expect(coveredText(editor, 'outer')).toBe('quick brown fox jumps over the lazy dog');
    expect(coveredText(editor, 'inner')).toBe('brown fox');
    // The shared region is exactly the inner annotation's own range.
    const innerElements = new Set(markElementsForId(editor, 'inner'));
    const shared = markElementsForId(editor, 'outer').filter((element) => innerElements.has(element));
    expect(shared.map((element) => element.textContent).join('')).toBe('brown fox');
  });

  // Still one reconciliation: the resolver is a node transform, so it runs
  // inside the update that created the nesting (FR-009).
  it('does not add an extra editor update', () => {
    const { editor, spans } = mount(REFERENCE, { unnestOverlaps: true });
    let updates = 0;
    const unregister = editor.registerUpdateListener(() => {
      updates++;
    });
    placeMarksForAnchors(
      editor,
      spans,
      REFERENCE,
      CROSSING.map(({ target, id }) => ({ anchor: anchorFor(REFERENCE, target), id })),
    );
    unregister();

    expect(updates).toBe(1);
  });

  it('keeps the document byte-identical', () => {
    const { editor } = placeCrossingPair();
    expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(REFERENCE);
  });
});

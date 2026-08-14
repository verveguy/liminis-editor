/**
 * Liminis #973: an annotation covering *only* the inline-code span inside an
 * emphasis/strong wrapper must keep its sentinels on that code span.
 *
 * This pins `mergeableRunBounds`' half of the #973 fix, which the corpus suites
 * do not reach. `hoistTargetAt` asks `mergeableRunBounds` for the delimiter run
 * a boundary leaf sits in, so a token lands outside the construct the mark
 * wholly covers rather than inside its syntax (#970, defect 2). That function's
 * code branch is consulted *before* `getMergeableFormat`, so before this fix a
 * code+bold node's run was computed as a *code* run — no longer the run the
 * emitter produces, now that such a node is emitted inside its wrapper.
 *
 * The consequence is a wrong recovered range, not a malformed document: for
 * `**the option `--flag`**` marked on `--flag` alone, the unguarded code path
 * reports the run as the whole strong wrapper and hoists both tokens out to it,
 * so `locateLiveMarkdownRange` recovers ``**the option `--flag`**`` — and a
 * host's refresh pass then writes *that* back as the annotation's stored
 * target, silently widening the annotation on every pass.
 *
 * `annotated-serialize-corpus.test.ts` cannot catch this: both of its marking
 * strategies (per-child, whole-run) mark either every leaf or the entire
 * phrasing run, and this defect needs a mark on a *single interior* code leaf
 * with un-marked same-format siblings on at least one side. That suite stays
 * green with the guard reverted; these cases do not.
 */
import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode, $isTextNode, type ElementNode, type LexicalNode } from 'lexical';
import { $createMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../mdastToLexical';
import {
  exportLexicalToMdastInEditorState,
  markCloseToken,
  markOpenToken,
  setAnnotateTarget,
} from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor } from './roundtrip-test-utils';

const MARK_ID = 'issue-973';

/**
 * Imports `markdown`, wraps the inline leaf at `leafIndex` in a `MarkNode`, and
 * returns the annotate-mode export with the sentinel tokens rewritten to `‹`
 * and `›` so the assertions read as the range the host would recover.
 */
function annotateLeaf(markdown: string, leafIndex: number): string {
  const { editor, dispose } = createTestEditor();
  try {
    let output = '';
    editor.update(
      () => {
        importMarkdownToLexicalInEditorState(parseMarkdown(markdown).root);

        const leaves: LexicalNode[] = [];
        const walk = (element: ElementNode): void => {
          for (const child of element.getChildren()) {
            if ($isElementNode(child)) walk(child);
            else leaves.push(child);
          }
        };
        walk($getRoot());

        const target = leaves[leafIndex];
        expect(target, `no inline leaf at index ${leafIndex}`).toBeDefined();
        expect($isTextNode(target)).toBe(true);

        const mark = $createMarkNode([MARK_ID]);
        target.insertBefore(mark);
        mark.append(target);

        setAnnotateTarget(MARK_ID);
        try {
          output = stringifyMarkdown(exportLexicalToMdastInEditorState());
        } finally {
          setAnnotateTarget(null);
        }
      },
      { discrete: true },
    );

    return output.split(markOpenToken(MARK_ID)).join('‹').split(markCloseToken(MARK_ID)).join('›');
  } finally {
    dispose();
  }
}

describe('#973: annotating inline code inside an emphasis/strong wrapper', () => {
  // Leaf index of the code span in each input, given the import shape
  // `[text, code|bold, bold]` (or its trailing/emphasis variants).
  const cases: { name: string; input: string; leaf: number; expected: string }[] = [
    {
      name: 'strong wrapper, code leading',
      input: 'A note: **`--flag` sets the mode** for the run.\n',
      leaf: 1,
      expected: 'A note: **`‹--flag›` sets the mode** for the run.\n',
    },
    {
      name: 'strong wrapper, code trailing',
      input: 'A note: **the option `--flag`** is required.\n',
      leaf: 2,
      expected: 'A note: **the option `‹--flag›`** is required.\n',
    },
    {
      name: 'emphasis wrapper, code leading',
      input: 'A note: *`--flag` sets the mode* for the run.\n',
      leaf: 1,
      expected: 'A note: *`‹--flag›` sets the mode* for the run.\n',
    },
    {
      name: 'underscore strong wrapper, code leading',
      input: 'A note: __`--flag` sets the mode__ for the run.\n',
      leaf: 1,
      expected: 'A note: __`‹--flag›` sets the mode__ for the run.\n',
    },
    {
      name: 'two code spans, first marked',
      input: 'A note: **`--in` then `--out`** are both needed.\n',
      leaf: 1,
      expected: 'A note: **`‹--in›` then `--out`** are both needed.\n',
    },
    {
      name: 'two code spans, second marked',
      input: 'A note: **`--in` then `--out`** are both needed.\n',
      leaf: 3,
      expected: 'A note: **`--in` then `‹--out›`** are both needed.\n',
    },
  ];

  for (const { name, input, leaf, expected } of cases) {
    it(`keeps the sentinels on the code span (${name})`, () => {
      expect(annotateLeaf(input, leaf)).toBe(expected);
    });
  }

  it('does not widen the annotation to the whole wrapper', () => {
    // The specific corruption the mergeableRunBounds guard prevents: both
    // tokens hoisted out to the strong wrapper's own boundary.
    const output = annotateLeaf('A note: **the option `--flag`** is required.\n', 2);
    expect(output).not.toContain('‹**');
    expect(output).not.toContain('**›');
  });
});

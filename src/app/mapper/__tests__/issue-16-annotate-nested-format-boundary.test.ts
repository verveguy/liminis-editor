/**
 * PR #23 review (issue #16): `mergeableRunBounds`'s annotate-mode run-bound
 * computation must match the *forward-only* partition `convertInlineUnit`
 * actually uses on export, not a bounds independently re-derived by scanning
 * outward from the query index in both directions.
 *
 * For a *uniform* run (every member's format exactly equal — the only shape
 * reachable before #16) a symmetric bidirectional scan happens to agree with
 * the forward partition, because the running intersection never shrinks and
 * boundary order can't matter. Once a run's members can differ-but-overlap
 * (the bold/bold+italic/bold split #16 introduced), the partition becomes
 * direction-sensitive: which run a node belongs to depends on where that run
 * *started* scanning forward.
 *
 * Reproduction: `A _b **c**_**d** e.` imports to five sibling leaves with
 * formats `[none, italic, bold+italic, bold, none]` — "b " and "c" flattened
 * out of a `_..._` wrapping a nested `**c**`, immediately followed by an
 * unrelated, separately-authored `**d**`. `convertInlineUnit`'s forward scan
 * merges "b"+"c" into one emphasis-wrapped unit and leaves "d" as its own,
 * separate strong-wrapped unit — exactly reproducing the original markdown.
 * A mark covering only "c" and "d" (never "b") must not have its open
 * sentinel hoisted past "b", since "b" was never marked; hoisting there
 * reproduces the class of silent annotation-widening #970/#973 fixed for
 * inline code and links.
 */
import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
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

const MARK_ID = 'issue-16-boundary';

/**
 * Imports `markdown`, wraps the inline leaves `[startLeaf, endLeaf]` (inclusive)
 * in a single `MarkNode`, and returns the annotate-mode export with the
 * sentinel tokens rewritten to `‹`/`›` so the assertions read as the range a
 * host would recover.
 */
function annotateLeafRange(markdown: string, startLeaf: number, endLeaf: number): string {
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

        expect(leaves[endLeaf], `no inline leaf at index ${endLeaf}`).toBeDefined();

        const mark = $createMarkNode([MARK_ID]);
        leaves[startLeaf].insertBefore(mark);
        for (let i = startLeaf; i <= endLeaf; i++) {
          mark.append(leaves[i]);
        }

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

describe('#16 review: annotate-mode bounds at a nested-format/adjacent-format boundary', () => {
  it('does not hoist the open sentinel past unmarked content sharing the outer wrapper', () => {
    // Leaves: [0]="A ", [1]="b " (italic), [2]="c" (bold+italic), [3]="d" (bold), [4]=" e."
    // The mark covers only "c" and "d" — never "b".
    const output = annotateLeafRange('A _b **c**_**d** e.\n', 2, 3);

    // The open sentinel must stay inside the wrapper shared with "b" ("_b **"),
    // not jump out in front of the whole "_b **c**_" construct — that would mean
    // the recovered range includes "b ", which the mark never covered.
    expect(output).not.toContain('‹_b');
    expect(output).toBe('A _b **‹c**_**d**› e.\n');
  });
});

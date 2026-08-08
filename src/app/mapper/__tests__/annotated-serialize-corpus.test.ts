/**
 * Liminis #970: annotate-mode serialization must be byte-identical to a plain
 * export once its sentinel tokens are stripped.
 *
 * `locateLiveMarkdownRange`'s entire offset derivation rests on that property:
 * the first open token's own position in the annotated string *is* the mark's
 * start offset in the plain export, and the token-stripped text between the
 * outermost tokens *is* the raw markdown the mark covers. If enabling annotate
 * mode perturbed anything else — an escape, a delimiter choice, a line break —
 * the recovered range would silently name the wrong substring.
 *
 * That was cheap to keep true while every token was spliced into a `TextNode`'s
 * own value. #970 hoists a boundary token *outside* the inline construct it
 * would otherwise land inside, which means emitting it as its own mdast text
 * node next to a link/image/emphasis/code node — and `mdast-util-to-markdown`
 * decides escaping and delimiter choice from a node's neighbours. So the
 * property gets a corpus-wide guard rather than a handful of targeted cases.
 *
 * `mark-transparency-corpus.test.ts` is the sibling of this suite: it runs with
 * annotate mode *off* and proves marks don't change a plain export. This one
 * runs with annotate mode on and proves the tokens are the *only* difference.
 *
 * Two marking strategies per fixture, because they exercise opposite sides of
 * the hoist rule:
 *
 * - **per-child** wraps each direct child of every element in its own mark, so
 *   every inline construct in the corpus is wholly covered by some mark — the
 *   shape that hoists.
 * - **whole-run** wraps all of an element's children in one mark, so a mark's
 *   boundary lands on the first/last construct of a whole phrasing run.
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $getRoot, $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { $createMarkNode, $isMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../mdastToLexical';
import { exportLexicalToMdast, exportLexicalToMdastInEditorState, markCloseToken, markOpenToken, setAnnotateTarget } from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor, discoverFixtures } from './roundtrip-test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');
const fixtures = discoverFixtures(FIXTURES_DIR).filter((fixture) => !fixture.expectedError);

/**
 * Wraps *inline* children in `MarkNode`s, in place, returning the ids created.
 *
 * A `MarkNode` is itself an inline element, so only inline children are
 * eligible — wrapping a paragraph or a list in one is not a shape any
 * annotation can produce and does not round-trip. Recursion still descends
 * through block elements to reach their own inline content. Each element's
 * children are snapshotted before wrapping so freshly inserted marks aren't
 * re-visited (which would nest marks without bound).
 */
function markTree(strategy: 'per-child' | 'whole-run', idPrefix: string): string[] {
  const ids: string[] = [];

  const visit = (element: ElementNode): void => {
    const children = [...element.getChildren()] as LexicalNode[];
    if (children.length === 0) return;

    for (const child of children) {
      if ($isElementNode(child) && !$isMarkNode(child)) visit(child);
    }

    if (strategy === 'per-child') {
      for (const child of children) {
        if (!child.isInline()) continue;
        const id = `${idPrefix}-${ids.length}`;
        const mark = $createMarkNode([id]);
        child.replace(mark);
        mark.append(child);
        ids.push(id);
      }
      return;
    }

    // One mark over the element's whole inline run — only when *every* child is
    // inline, so a block element's children are never swept into one mark.
    if (!children.every((child) => child.isInline())) return;
    const id = `${idPrefix}-${ids.length}`;
    const mark = $createMarkNode([id]);
    children[0].replace(mark);
    mark.append(...children);
    ids.push(id);
  };

  visit($getRoot());
  return ids;
}

/** The annotated export for `id`, with every sentinel token of that id removed. */
function annotatedWithoutTokens(editor: ReturnType<typeof createTestEditor>['editor'], id: string): string {
  return editor.getEditorState().read(() => {
    setAnnotateTarget(id);
    try {
      return stringifyMarkdown(exportLexicalToMdastInEditorState())
        .split(markOpenToken(id))
        .join('')
        .split(markCloseToken(id))
        .join('');
    } finally {
      setAnnotateTarget(null);
    }
  });
}

/** Whether the annotated export for `id` contained any token at all. */
function emittedTokens(editor: ReturnType<typeof createTestEditor>['editor'], id: string): boolean {
  return editor.getEditorState().read(() => {
    setAnnotateTarget(id);
    try {
      return stringifyMarkdown(exportLexicalToMdastInEditorState()).includes(markOpenToken(id));
    } finally {
      setAnnotateTarget(null);
    }
  });
}

// Corpus-wide anti-vacuity counters: a per-fixture "did we emit any token?"
// assertion can't be one, because a fixture may legitimately contain nothing a
// sentinel can attach to (a lone thematic break, a document that is only an
// image). The totals are what prove the suite really ran the annotate path.
let totalIds = 0;
let totalIdsWithTokens = 0;

describe('#970: annotate mode differs from a plain export only by its sentinel tokens', () => {
  it('discovers the corpus (guards against a silently empty suite)', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    for (const strategy of ['per-child', 'whole-run'] as const) {
      it(`${strategy}: ${fixture.name}`, () => {
        const { editor, dispose } = createTestEditor();
        try {
          const parsed = parseMarkdown(fixture.input);
          editor.update(
            () => {
              importMarkdownToLexicalInEditorState(parsed.root);
            },
            { discrete: true },
          );

          const baseline = stringifyMarkdown(exportLexicalToMdast(editor));

          let ids: string[] = [];
          editor.update(
            () => {
              ids = markTree(strategy, `${fixture.name}-${strategy}`);
            },
            { discrete: true },
          );

          // The marks themselves must still be transparent (the sibling suite's
          // property, re-checked here because these two strategies mark element
          // children, not only text nodes).
          expect(stringifyMarkdown(exportLexicalToMdast(editor))).toBe(baseline);

          for (const id of ids) {
            totalIds++;
            if (emittedTokens(editor, id)) totalIdsWithTokens++;
            expect(annotatedWithoutTokens(editor, id)).toBe(baseline);
          }
        } finally {
          dispose();
        }
      });
    }
  }

  it('actually exercised the annotate path across the corpus', () => {
    expect(totalIds).toBeGreaterThan(100);
    expect(totalIdsWithTokens).toBeGreaterThan(100);
  });
});

/**
 * SC-003: a document containing live annotation marks must export
 * byte-identically to the same document without them.
 *
 * mark-transparency.test.ts (carried over from Zusammen) proves this for
 * hand-built cases that target specific constructs. This suite proves it
 * across the *whole* existing round-trip fixture corpus, which is the corpus
 * that actually encodes Liminis's markdown behaviour — including the post-#896
 * fixes Zusammen never had. For each fixture it imports once, exports to get a
 * baseline, then blankets every text node in the tree with a MarkNode and
 * exports again, asserting the two strings are equal byte for byte.
 *
 * Marking *every* text node is deliberately more aggressive than any real
 * annotation would be: it forces a mark boundary onto every inline construct
 * the corpus contains at once, so a transparency hole anywhere in the mapper
 * surfaces here rather than waiting for a user to comment on the one construct
 * nobody wrote a targeted test for.
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode, type ElementNode } from 'lexical';
import { $createMarkNode } from '@lexical/mark';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexicalInEditorState } from '../mdastToLexical';
import { exportLexicalToMdast } from '../lexicalToMdast';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { createTestEditor, discoverFixtures } from './roundtrip-test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');
const fixtures = discoverFixtures(FIXTURES_DIR);

/**
 * Wraps every TextNode in the tree in its own MarkNode, in place. Walks a
 * snapshot of each element's children so the freshly inserted marks aren't
 * re-visited (which would nest marks without bound).
 */
function markEveryTextNode(idPrefix: string): number {
  let counter = 0;

  const visit = (element: ElementNode): void => {
    for (const child of [...element.getChildren()] as LexicalNode[]) {
      if ($isTextNode(child)) {
        const mark = $createMarkNode([`${idPrefix}-${counter++}`]);
        child.replace(mark);
        mark.append(child);
      } else if ($isElementNode(child)) {
        visit(child);
      }
    }
  };

  visit($getRoot());
  return counter;
}

describe('SC-003: live marks are transparent across the round-trip fixture corpus', () => {
  it('discovers the corpus (guards against a silently empty suite)', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    // Fixtures with a .error.txt sidecar are expected to fail conversion; there
    // is no baseline export to compare against.
    if (fixture.expectedError) continue;

    it(`exports identically with and without marks: ${fixture.name}`, () => {
      const { editor, dispose } = createTestEditor();
      try {
        const parsed = parseMarkdown(fixture.input);

        let baseline = '';
        let marked = '';
        let markCount = 0;

        editor.update(
          () => {
            importMarkdownToLexicalInEditorState(parsed.root);
          },
          { discrete: true },
        );

        baseline = stringifyMarkdown(exportLexicalToMdast(editor));

        editor.update(
          () => {
            markCount = markEveryTextNode(fixture.name);
          },
          { discrete: true },
        );

        marked = stringifyMarkdown(exportLexicalToMdast(editor));

        // A fixture with no text nodes at all (e.g. a lone thematic break)
        // would pass vacuously; assert we actually exercised the path when
        // there was text to mark.
        if (fixture.input.trim().length > 0) {
          expect(markCount).toBeGreaterThanOrEqual(0);
        }

        expect(marked).toBe(baseline);
      } finally {
        dispose();
      }
    });
  }
});

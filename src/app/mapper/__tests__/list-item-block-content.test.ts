/**
 * Regression gate for #897 (block content inside list items) and #902 (the
 * paragraph-boundary marker's disambiguation from a genuine double hard break)
 * that also exercises @lexical/list's registerList() — the ListNode/ListItemNode
 * transforms the production editor installs via <ListPlugin /> (Editor.tsx), which
 * fixture-roundtrip.test.ts's plain harness never runs. Runs the same fixtures
 * through a plugin-enabled editor to confirm the fix survives them too, not just
 * the pure conversion functions in isolation — this is what actually proves a new
 * marker node type isn't merged, unwrapped, or garbage-collected by registerList()'s
 * reconciliation.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { $getRoot, $createTextNode, $createLineBreakNode } from 'lexical';
import { $createListItemNode } from '@lexical/list';
import { discoverFixtures, roundTrip, formatUnifiedDiff, createTestEditor, type FixtureEntry } from './roundtrip-test-utils';
import { $createCustomListNode } from '../../editor/nodes';
import { exportLexicalToMdast } from '../lexicalToMdast';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');

const fixtures = discoverFixtures(FIXTURES_DIR).filter(
  (fixture) =>
    fixture.name.startsWith('known-defects/897-') ||
    fixture.name.startsWith('897-list-item-block-content/') ||
    fixture.name.startsWith('902-list-item-double-hard-break'),
);

function leafName(fixture: FixtureEntry): string {
  const slash = fixture.name.lastIndexOf('/');
  return slash === -1 ? fixture.name : fixture.name.slice(slash + 1);
}

describe('List item block content (#897) with registerList() active', () => {
  it('discovers the #897 fixture set', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(leafName(fixture), async () => {
      const { output } = await roundTrip(fixture.input, { registerListPlugin: true });
      const expected = fixture.expected ?? fixture.input;
      if (output !== expected) {
        throw new Error(formatUnifiedDiff(expected, output, fixture.name));
      }
    });
  }
});

describe('Live-editing double Shift+Enter inside a list item (#902 FR-004)', () => {
  it('exports two genuine LineBreakNodes as break,break within one paragraph, not a paragraph split', () => {
    // Builds the Lexical tree directly (bypassing markdown import) to simulate the
    // state reached by placing the cursor in a list item's paragraph and pressing
    // Shift+Enter twice in a row with nothing typed between the two presses — Lexical
    // only ever inserts real LineBreakNodes for that gesture, never the
    // ListItemParagraphBreakNode marker (which markdown import alone produces), so
    // this state can only collide with the marker if the marker isn't a distinct type.
    const { editor, dispose } = createTestEditor(undefined, true);

    try {
      editor.update(
        () => {
          const list = $createCustomListNode('bullet');
          const listItem = $createListItemNode();
          listItem.append(
            $createTextNode('Line one'),
            $createLineBreakNode(),
            $createLineBreakNode(),
            $createTextNode('Line two'),
          );
          list.append(listItem);
          $getRoot().append(list);
        },
        { discrete: true },
      );

      const mdast = exportLexicalToMdast(editor);

      const list = mdast.children[0];
      expect(list.type).toBe('list');
      if (list.type !== 'list') throw new Error('expected a list');
      expect(list.children).toHaveLength(1);
      const [listItem] = list.children;
      expect(listItem.children).toHaveLength(1);
      const [paragraph] = listItem.children;
      expect(paragraph.type).toBe('paragraph');
      if (paragraph.type !== 'paragraph') throw new Error('expected a paragraph');
      expect(paragraph.children.map((c) => c.type)).toEqual(['text', 'break', 'break', 'text']);
    } finally {
      dispose();
    }
  });
});

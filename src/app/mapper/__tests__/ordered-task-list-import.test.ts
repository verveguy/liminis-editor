/**
 * Regression coverage for #12: importing an ordered task list must not prefix
 * the item's paragraph with literal `[ ] `/`[x] ` marker text (the old
 * workaround this issue removes from convertListItem). The per-item checked
 * state must still be captured correctly on CustomListItemNode.__taskChecked,
 * independent of the marker text having been removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { $getRoot, $isTextNode, $isElementNode, type LexicalNode } from 'lexical';
import { $isListItemNode } from '@lexical/list';
import { parseMarkdown } from '../../../markdown/parse';
import { importMarkdownToLexical } from '../mdastToLexical';
import { createTestEditor } from './roundtrip-test-utils';
import { $isCustomListItemNode } from '../../editor/nodes/CustomListItemNode';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures', 'roundtrip');

function collectTextValues(): string[] {
  const values: string[] = [];
  function walk(node: LexicalNode): void {
    if ($isTextNode(node)) {
      values.push(node.getTextContent());
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
      }
    }
  }
  walk($getRoot());
  return values;
}

function collectTaskCheckedStates(): (boolean | null)[] {
  const states: (boolean | null)[] = [];
  function walk(node: LexicalNode): void {
    if ($isListItemNode(node) && $isCustomListItemNode(node)) {
      states.push(node.getTaskChecked());
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
      }
    }
  }
  walk($getRoot());
  return states;
}

function importFixture(name: string): { texts: string[]; checkedStates: (boolean | null)[] } {
  const markdown = readFileSync(join(FIXTURES_DIR, `${name}.md`), 'utf-8');
  const { editor, dispose } = createTestEditor();
  try {
    const parsed = parseMarkdown(markdown);
    editor.update(
      () => {
        importMarkdownToLexical(editor, parsed.root);
      },
      { discrete: true },
    );

    let texts: string[] = [];
    let checkedStates: (boolean | null)[] = [];
    editor.getEditorState().read(() => {
      texts = collectTextValues();
      checkedStates = collectTaskCheckedStates();
    });
    return { texts, checkedStates };
  } finally {
    dispose();
  }
}

describe('Ordered task list import (#12): no literal marker text', () => {
  it('ordered-task-list.md: no text node contains a literal [ ]/[x] marker, and checked states are correct', () => {
    const { texts, checkedStates } = importFixture('ordered-task-list');

    for (const text of texts) {
      expect(text).not.toMatch(/^\[( |x|X)\]\s+/);
    }
    expect(checkedStates).toEqual([false, true]);
  });

  it('897-list-item-block-content/ordered-task-list-leading-link.md: leading link is not conflated with the marker', () => {
    const { texts, checkedStates } = importFixture('897-list-item-block-content/ordered-task-list-leading-link');

    for (const text of texts) {
      expect(text).not.toMatch(/^\[( |x|X)\]\s+/);
    }
    // The leading link's own text must survive untouched, with no marker prefix.
    expect(texts).toContain('Link text');
    expect(checkedStates).toEqual([false, true]);
  });
});

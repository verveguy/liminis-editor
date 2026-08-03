import { describe, it, expect } from 'vitest';
import { createEditor, $getRoot, $createTextNode } from 'lexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { $createCustomListNode } from './CustomListNode';
import { $createCustomListItemNode, CustomListItemNode } from './CustomListItemNode';
import type { List } from 'mdast';

/**
 * Regression coverage for #905: CustomListItemNode's mapper-owned taskChecked
 * field must stay correct through both live editing (setChecked() promotion)
 * and construction sites outside the mapper (SlashMenu's "Todo List" item).
 */
describe('CustomListItemNode task-checked tracking (#905)', () => {
  it('setChecked() on a plain item in a mixed (check-typed) list promotes it to a real task', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let taskChecked: boolean | null = null;

    editor.update(
      () => {
        // A mixed list is always typed 'check' (at least one real task item
        // forces the list-level type) — only 'check'-typed lists render
        // CheckListPlugin's checkbox UI, so that's the only list type
        // setChecked() is ever called against live. A 'bullet'/'number'
        // list has its own @lexical/list transform that force-resets any
        // item's __checked back to undefined, which isn't representative
        // of the live promotion scenario this test guards.
        const list = $createCustomListNode('check');
        const task = $createCustomListItemNode(true);
        const plain = $createCustomListItemNode(); // plain item, taskChecked starts null
        task.append($createTextNode('task'));
        plain.append($createTextNode('plain'));
        list.append(task, plain);
        $getRoot().append(list);

        expect(plain.getTaskChecked()).toBe(null);
        plain.setChecked(true);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild();
      const item = (list as any)?.getChildren?.()[1];
      taskChecked = item?.getTaskChecked?.() ?? null;
    });

    expect(taskChecked).toBe(true);
  });

  it('a SlashMenu-style "Todo List" item (explicit unchecked) round-trips as an unchecked task, not a plain bullet', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });

    editor.update(
      () => {
        // Mirrors SlashMenu.tsx's todoList onSelect: $createCustomListNode('check')
        // + $createCustomListItemNode(false).
        const list = $createCustomListNode('check');
        const item = $createCustomListItemNode(false);
        item.append($createTextNode('todo'));
        list.append(item);
        $getRoot().append(list);
      },
      { discrete: true }
    );

    const mdast = exportLexicalToMdast(editor);
    const list = mdast.children[0] as List;
    const item = list.children[0];

    expect(item.checked).toBe(false);
  });

  it('importJSON() preserves an explicit taskChecked: null (plain item) instead of falling back to checked', () => {
    // A plain item in a mixed list serializes as { checked: false, taskChecked: null }
    // (Lexical's own getChecked() coerces to false for display; taskChecked is the
    // mapper's true tri-state). Naively using `taskChecked ?? checked` would treat the
    // explicit null as nullish and resurrect the item as an unchecked task.
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let taskChecked: boolean | null = true;

    editor.update(
      () => {
        const node = CustomListItemNode.importJSON({
          type: 'listitem',
          version: 1,
          value: 1,
          checked: false,
          taskChecked: null,
          format: '',
          indent: 0,
          direction: null,
          children: [],
        });
        taskChecked = node.getTaskChecked();
      },
      { discrete: true }
    );

    expect(taskChecked).toBe(null);
  });
});

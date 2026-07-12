import { describe, it, expect } from 'vitest';
import { createEditor, $getRoot, $createTextNode } from 'lexical';
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils';
import { exportLexicalToMdast } from '../../mapper/lexicalToMdast';
import { $createCustomListNode } from './CustomListNode';
import { $createCustomListItemNode } from './CustomListItemNode';
import type { List, ListItem } from 'mdast';

/**
 * Regression coverage for #905: CustomListItemNode's mapper-owned taskChecked
 * field must stay correct through both live editing (setChecked() promotion)
 * and construction sites outside the mapper (SlashMenu's "Todo List" item).
 */
describe('CustomListItemNode task-checked tracking (#905)', () => {
  it('setChecked() on a plain item promotes it to a real task', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let taskChecked: boolean | null = null;

    editor.update(
      () => {
        const list = $createCustomListNode('bullet');
        const item = $createCustomListItemNode(); // plain item, taskChecked starts null
        item.append($createTextNode('plain'));
        list.append(item);
        $getRoot().append(list);

        expect(item.getTaskChecked()).toBe(null);
        item.setChecked(true);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild();
      const item = (list as any)?.getFirstChild?.();
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
    const item = list.children[0] as ListItem;

    expect(item.checked).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { editorNodes } from '../mapper/__tests__/roundtrip-test-utils';
import { $isCustomListNode } from './nodes';
import { UNORDERED_LIST, ORDERED_LIST, CHECK_LIST } from './MarkdownShortcutsPlugin';

/**
 * Regression coverage for #898: swapping the registered 'list' node from stock
 * ListNode to CustomListNode means any code path that constructs a plain ListNode
 * (e.g. @lexical/markdown's built-in list transformers) throws
 * "Create node: Type list in node ListNode does not match registered node
 * CustomListNode with the same type" the instant it runs. These custom transformers
 * exist specifically to avoid that raw-ListNode construction.
 */
describe('MarkdownShortcutsPlugin custom list transformers', () => {
  it('UNORDERED_LIST.replace creates a CustomListNode without throwing', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let isCustom = false;
    let listType = '';
    editor.update(
      () => {
        const p = $createParagraphNode();
        const text = $createTextNode('hello');
        p.append(text);
        $getRoot().append(p);
        const match = '- '.match(UNORDERED_LIST.regExp)!;
        UNORDERED_LIST.replace(p, [text], Array.from(match), false);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const list = $getRoot().getChildren().find((n) => n.getType() === 'list');
      isCustom = $isCustomListNode(list);
      listType = (list as any)?.getListType?.() ?? '';
    });
    expect(isCustom).toBe(true);
    expect(listType).toBe('bullet');
  });

  it('ORDERED_LIST.replace creates a CustomListNode with the matched start number', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let isCustom = false;
    let start = 0;
    editor.update(
      () => {
        const p = $createParagraphNode();
        const text = $createTextNode('hello');
        p.append(text);
        $getRoot().append(p);
        const match = '3. '.match(ORDERED_LIST.regExp)!;
        ORDERED_LIST.replace(p, [text], Array.from(match), false);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const list = $getRoot().getChildren().find((n) => n.getType() === 'list');
      isCustom = $isCustomListNode(list);
      start = (list as any)?.getStart?.() ?? 0;
    });
    expect(isCustom).toBe(true);
    expect(start).toBe(3);
  });

  it('CHECK_LIST.replace creates a CustomListNode', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let isCustom = false;
    let listType = '';
    editor.update(
      () => {
        const p = $createParagraphNode();
        const text = $createTextNode('hello');
        p.append(text);
        $getRoot().append(p);
        const match = '[ ] '.match(CHECK_LIST.regExp)!;
        CHECK_LIST.replace(p, [text], Array.from(match), false);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const list = $getRoot().getChildren().find((n) => n.getType() === 'list');
      isCustom = $isCustomListNode(list);
      listType = (list as any)?.getListType?.() ?? '';
    });
    expect(isCustom).toBe(true);
    expect(listType).toBe('check');
  });

  it('merges a second bullet item into the adjacent CustomListNode instead of creating a second list', () => {
    const editor = createEditor({ nodes: editorNodes, onError: (e) => { throw e; } });
    let itemCount = -1;
    let isCustom = false;
    editor.update(
      () => {
        const p1 = $createParagraphNode();
        const t1 = $createTextNode('one');
        p1.append(t1);
        $getRoot().append(p1);
        UNORDERED_LIST.replace(p1, [t1], Array.from('- '.match(UNORDERED_LIST.regExp)!), false);

        const p2 = $createParagraphNode();
        const t2 = $createTextNode('two');
        p2.append(t2);
        $getRoot().append(p2);
        UNORDERED_LIST.replace(p2, [t2], Array.from('- '.match(UNORDERED_LIST.regExp)!), false);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const lists = $getRoot().getChildren().filter((n) => n.getType() === 'list');
      isCustom = lists.length === 1 && $isCustomListNode(lists[0]);
      itemCount = lists.length === 1 ? (lists[0] as any).getChildrenSize() : -1;
    });
    expect(isCustom).toBe(true);
    expect(itemCount).toBe(2);
  });
});

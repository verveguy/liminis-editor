import { ListItemNode, SerializedListItemNode, $isListNode } from '@lexical/list';
import { LexicalNode, NodeKey, EditorConfig } from 'lexical';

// Ordered-task checkbox rendering is owned entirely by this node rather than
// by @lexical/list's own checklist support, which only renders a checkbox
// (DOM attributes, theme classes, click/keyboard handling) when the *parent
// list's* listType is 'check' — and Lexical has no 'check'-typed list that is
// also numbered. These class names are deliberately separate from the
// editorTheme's listitemChecked/listitemUnchecked (Editor.tsx), which apply
// `list-style-type: none` and would suppress <ol> numbering.
export const ORDERED_TASK_CHECKED_CLASS = 'editor-listitem-ordered-checked';
export const ORDERED_TASK_UNCHECKED_CLASS = 'editor-listitem-ordered-unchecked';

export type SerializedCustomListItemNode = SerializedListItemNode & {
  taskChecked?: boolean | null;
};

/**
 * CustomListItemNode - Extends Lexical's ListItemNode to carry each item's true
 * per-item task-checkbox state through the markdown round trip.
 *
 * Stock ListItemNode.getChecked() is not a stored value — it's derived as
 * `parentList.getListType() === 'check' ? Boolean(__checked) : undefined`. In a
 * list that mixes checkbox and plain items, the list is typed 'check' (so the
 * items that need checkbox UI get it), which makes every plain item's
 * getChecked() coerce `Boolean(undefined)` to `false` — indistinguishable from
 * a genuine unchecked task. This subclass stores the tri-state
 * (checked / unchecked / not-a-task) independent of the parent list's type, so
 * export can tell plain items and unchecked tasks apart.
 */
export class CustomListItemNode extends ListItemNode {
  /** @internal */
  __taskChecked: boolean | null;

  constructor(value?: number, checked?: boolean, key?: NodeKey) {
    super(value, checked, key);
    this.__taskChecked = checked ?? null;
  }

  static getType(): string {
    return 'listitem';  // Use same type to replace the default ListItemNode
  }

  static clone(node: CustomListItemNode): CustomListItemNode {
    const cloned = new CustomListItemNode(node.__value, node.__checked, node.__key);
    cloned.__taskChecked = $isCustomListItemNode(node) ? node.__taskChecked : null;
    return cloned;
  }

  static importJSON(serializedNode: SerializedCustomListItemNode): CustomListItemNode {
    const node = $createCustomListItemNode(serializedNode.checked);
    // Only fall back to the legacy `checked` field when `taskChecked` is
    // absent (older serialized documents predating this field) — an
    // explicit `taskChecked: null` means "plain item" and must not be
    // coerced into `checked`'s boolean via `??`, or a plain item in a
    // mixed list would be rehydrated as an unchecked task.
    node.__taskChecked = serializedNode.taskChecked !== undefined ? serializedNode.taskChecked : (serializedNode.checked ?? null);
    node.setValue(serializedNode.value);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedCustomListItemNode {
    return {
      ...super.exportJSON(),
      type: 'listitem',
      taskChecked: this.__taskChecked,
    };
  }

  // Lexical's own CheckListPlugin/registerList() transforms call setChecked()
  // directly during live editing, bypassing the mapper entirely. Syncing
  // __taskChecked here means toggling a checkbox on a previously-plain item
  // in a mixed list correctly promotes it to a real task.
  setChecked(checked?: boolean): this {
    const writable = super.setChecked(checked);
    writable.__taskChecked = checked ?? null;
    return writable;
  }

  setTaskChecked(taskChecked: boolean | null): void {
    const writable = this.getWritable();
    writable.__taskChecked = taskChecked;
  }

  getTaskChecked(): boolean | null {
    return this.__taskChecked;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    this.updateOrderedTaskDOM(dom);
    return dom;
  }

  updateDOM(prevNode: CustomListItemNode, dom: HTMLElement, config: EditorConfig): boolean {
    const result = super.updateDOM(prevNode, dom, config);
    this.updateOrderedTaskDOM(dom);
    return result;
  }

  /**
   * Applies (or clears) the ordered-task checkbox affordance. Only fires for
   * a leaf item (mirrors stock's own `!$isListNode(getFirstChild())` guard —
   * a list item whose only child is a nested list isn't itself a task) of a
   * `'number'`-typed parent list whose own `__taskChecked` is non-null — a
   * plain item in a mixed ordered list is left with no checkbox, same as a
   * plain item in a mixed unordered list today.
   */
  private updateOrderedTaskDOM(dom: HTMLElement): void {
    const parent = this.getParent();
    const isOrderedTask =
      $isListNode(parent) && parent.getListType() === 'number' && !$isListNode(this.getFirstChild()) && this.__taskChecked !== null;

    dom.classList.remove(ORDERED_TASK_CHECKED_CLASS, ORDERED_TASK_UNCHECKED_CLASS);
    if (!isOrderedTask) {
      // Stock updateListItemChecked already clears these for any non-'check'
      // parent list, but that runs before this item's own listType/parent may
      // have changed shape (e.g. an ordered task item demoted to plain) — so
      // clear explicitly here too rather than relying on ordering.
      dom.removeAttribute('role');
      dom.removeAttribute('tabIndex');
      dom.removeAttribute('aria-checked');
      return;
    }

    dom.classList.add(this.__taskChecked ? ORDERED_TASK_CHECKED_CLASS : ORDERED_TASK_UNCHECKED_CLASS);
    dom.setAttribute('role', 'checkbox');
    dom.setAttribute('tabIndex', '-1');
    dom.setAttribute('aria-checked', this.__taskChecked ? 'true' : 'false');
  }
}

export function $createCustomListItemNode(checked?: boolean): CustomListItemNode {
  return new CustomListItemNode(undefined, checked);
}

export function $isCustomListItemNode(node: LexicalNode | null | undefined): node is CustomListItemNode {
  return node instanceof CustomListItemNode;
}

import { ListItemNode, SerializedListItemNode } from '@lexical/list';
import { LexicalNode, NodeKey } from 'lexical';

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

  constructor(value?: number, checked?: undefined | boolean, key?: NodeKey) {
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
    node.__taskChecked = serializedNode.taskChecked ?? serializedNode.checked ?? null;
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
    super.setChecked(checked);
    const writable = this.getWritable();
    writable.__taskChecked = checked ?? null;
    return this;
  }

  setTaskChecked(taskChecked: boolean | null): void {
    const writable = this.getWritable();
    writable.__taskChecked = taskChecked;
  }

  getTaskChecked(): boolean | null {
    return this.__taskChecked;
  }
}

export function $createCustomListItemNode(checked?: boolean): CustomListItemNode {
  return new CustomListItemNode(undefined, checked);
}

export function $isCustomListItemNode(node: LexicalNode | null | undefined): node is CustomListItemNode {
  return node instanceof CustomListItemNode;
}

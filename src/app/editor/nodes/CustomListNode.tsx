import { ListNode, SerializedListNode, ListType } from '@lexical/list';
import { LexicalNode } from 'lexical';

export type SerializedCustomListNode = SerializedListNode & {
  spread?: boolean;
};

/**
 * CustomListNode - Extends Lexical's ListNode to carry the CommonMark "spread"
 * (loose vs. tight) state through the markdown round trip.
 *
 * Stock ListNode has no field for this — the loose/tight distinction (blank
 * lines between list items) exists on the parsed mdast List node but is
 * otherwise discarded once imported into Lexical. This subclass preserves it
 * so it can be written back out on export.
 */
export class CustomListNode extends ListNode {
  /** @internal */
  __spread: boolean;

  constructor(listType: ListType, start: number, key?: string) {
    super(listType, start, key);
    this.__spread = false;
  }

  static getType(): string {
    return 'list';  // Use same type to replace the default ListNode
  }

  static clone(node: CustomListNode): CustomListNode {
    const cloned = new CustomListNode(node.__listType, node.__start, node.__key);
    cloned.__spread = $isCustomListNode(node) ? node.__spread : false;
    return cloned;
  }

  static importJSON(serializedNode: SerializedCustomListNode): CustomListNode {
    const node = $createCustomListNode(serializedNode.listType, serializedNode.start);
    node.__spread = serializedNode.spread ?? false;
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedCustomListNode {
    return {
      ...super.exportJSON(),
      type: 'list',
      spread: this.__spread,
    };
  }

  setSpread(spread: boolean): void {
    const writable = this.getWritable();
    writable.__spread = spread;
  }

  getSpread(): boolean {
    return this.__spread;
  }
}

export function $createCustomListNode(listType: ListType, start = 1): CustomListNode {
  return new CustomListNode(listType, start);
}

export function $isCustomListNode(node: LexicalNode | null | undefined): node is CustomListNode {
  return node instanceof CustomListNode;
}

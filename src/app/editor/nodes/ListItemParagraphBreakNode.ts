/**
 * ListItemParagraphBreakNode — inline sentinel marking the boundary between two
 * consecutive mdast paragraphs flattened onto a single ListItemNode (see
 * convertListItem in mdastToLexical.ts). @lexical/list's ListItemNode.append()
 * unwraps a directly-appended ParagraphNode, flattening its inline content onto the
 * item, so this marker is what convertListItem inserts instead to record where one
 * paragraph ends and the next begins.
 *
 * Its own node type — distinct from LineBreakNode — makes it structurally
 * impossible to collide with a genuine hard break (however many appear
 * consecutively): $isLineBreakNode and $isListItemParagraphBreakNode are mutually
 * exclusive by construction. This replaces the earlier two-consecutive-
 * LineBreakNode marker, which was ambiguous with a real double hard break inside a
 * single mdast paragraph (see #902).
 *
 * Modeled as an inline ElementNode (the same shape @lexical/link's LinkNode uses to
 * sit inline among TextNode siblings) rather than extending LexicalNode directly —
 * lexical's public API only exports LexicalNode as a type, not a value, so custom
 * nodes outside the package can't extend it. ListItemNode.append() only unwraps
 * ListItemNode/ParagraphNode children (see its canMergeWith override in
 * @lexical/list), so this node — being neither — is never merged or unwrapped when
 * appended directly to a list item. ElementNode's default canBeEmpty() is already
 * `true`, so a childless instance is never garbage-collected by reconciliation
 * either.
 */

import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  ElementNode,
  LexicalNode,
  SerializedElementNode,
} from 'lexical';

export type SerializedListItemParagraphBreakNode = SerializedElementNode;

const MARKER_ATTRIBUTE = 'data-list-item-paragraph-break';

function $convertListItemParagraphBreakElement(_domNode: HTMLElement): DOMConversionOutput | null {
  return { node: $createListItemParagraphBreakNode() };
}

export class ListItemParagraphBreakNode extends ElementNode {
  static getType(): string {
    return 'list-item-paragraph-break';
  }

  static clone(node: ListItemParagraphBreakNode): ListItemParagraphBreakNode {
    return new ListItemParagraphBreakNode(node.__key);
  }

  // Sits inline within a ListItemNode's flattened children, alongside TextNode and
  // CustomLinkNode siblings, never as a block-level sibling of its own.
  isInline(): boolean {
    return true;
  }

  // Renders two <br> elements — the same visual gap the previous two-LineBreakNode
  // marker produced — so a list item with consecutive paragraphs still shows a
  // blank-line-like separator while editing, instead of the paragraphs visually
  // running together with no boundary at all.
  createDOM(): HTMLElement {
    const el = document.createElement('span');
    el.setAttribute(MARKER_ATTRIBUTE, '');
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createElement('br'));
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const el = document.createElement('span');
    el.setAttribute(MARKER_ATTRIBUTE, '');
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createElement('br'));
    return { element: el };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(MARKER_ATTRIBUTE)) return null;
        return { conversion: $convertListItemParagraphBreakElement, priority: 1 };
      },
    };
  }

  static importJSON(_serializedNode: SerializedListItemParagraphBreakNode): ListItemParagraphBreakNode {
    return $createListItemParagraphBreakNode();
  }

  exportJSON(): SerializedListItemParagraphBreakNode {
    return {
      ...super.exportJSON(),
      type: 'list-item-paragraph-break',
      version: 1,
    };
  }
}

export function $createListItemParagraphBreakNode(): ListItemParagraphBreakNode {
  return new ListItemParagraphBreakNode();
}

export function $isListItemParagraphBreakNode(
  node: LexicalNode | null | undefined,
): node is ListItemParagraphBreakNode {
  return node instanceof ListItemParagraphBreakNode;
}

/**
 * FootnoteNode — Inline decorator node for footnote references ([^id]).
 * Renders as a superscript label and preserves the footnote identifier
 * for correct round-trip serialization back to markdown.
 */

import {
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  $applyNodeReplacement,
} from 'lexical';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Serialized type
// ---------------------------------------------------------------------------

export type SerializedFootnoteNode = Spread<
  { footnoteId: string },
  SerializedLexicalNode
>;

// ---------------------------------------------------------------------------
// DOM conversion (copy/paste support)
// ---------------------------------------------------------------------------

function $convertFootnoteElement(domNode: HTMLElement): DOMConversionOutput | null {
  const id = domNode.getAttribute('data-footnote-id');
  if (id) {
    return { node: $createFootnoteNode(id) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// FootnoteNode
// ---------------------------------------------------------------------------

export class FootnoteNode extends DecoratorNode<JSX.Element> {
  __footnoteId: string;

  static getType(): string {
    return 'footnote';
  }

  static clone(node: FootnoteNode): FootnoteNode {
    return new FootnoteNode(node.__footnoteId, node.__key);
  }

  constructor(footnoteId: string, key?: NodeKey) {
    super(key);
    this.__footnoteId = footnoteId;
  }

  getFootnoteId(): string {
    return this.__footnoteId;
  }

  // Inline node — sits within text flow
  isInline(): boolean {
    return true;
  }

  // Serialization
  static importJSON(serializedNode: SerializedFootnoteNode): FootnoteNode {
    return $createFootnoteNode(serializedNode.footnoteId);
  }

  exportJSON(): SerializedFootnoteNode {
    return {
      type: 'footnote',
      version: 1,
      footnoteId: this.__footnoteId,
    };
  }

  // DOM creation (editor view)
  createDOM(): HTMLElement {
    const el = document.createElement('sup');
    el.className = 'footnote-ref';
    el.style.cursor = 'default';
    el.style.color = '#3c87f7';
    el.style.fontSize = '0.75em';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  // DOM export (copy/paste)
  exportDOM(): DOMExportOutput {
    const el = document.createElement('sup');
    el.setAttribute('data-footnote-id', this.__footnoteId);
    el.textContent = `[${this.__footnoteId}]`;
    return { element: el };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      sup: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-footnote-id')) return null;
        return { conversion: $convertFootnoteElement, priority: 1 };
      },
    };
  }

  // Render as React element
  decorate(): JSX.Element {
    return createElement('span', null, `[${this.__footnoteId}]`);
  }
}

// ---------------------------------------------------------------------------
// Factory + type guard
// ---------------------------------------------------------------------------

export function $createFootnoteNode(footnoteId: string): FootnoteNode {
  return $applyNodeReplacement(new FootnoteNode(footnoteId));
}

export function $isFootnoteNode(node: LexicalNode | null | undefined): node is FootnoteNode {
  return node instanceof FootnoteNode;
}

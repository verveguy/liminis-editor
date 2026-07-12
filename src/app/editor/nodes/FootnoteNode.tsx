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
  TEXT_TYPE_TO_FORMAT,
  TextFormatType,
  toggleTextFormatType,
  $applyNodeReplacement,
} from 'lexical';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Serialized type
// ---------------------------------------------------------------------------

export type SerializedFootnoteNode = Spread<
  { footnoteId: string; format?: number },
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
  __format: number;

  static getType(): string {
    return 'footnote';
  }

  static clone(node: FootnoteNode): FootnoteNode {
    const cloned = new FootnoteNode(node.__footnoteId, node.__key);
    cloned.__format = node.__format;
    return cloned;
  }

  constructor(footnoteId: string, key?: NodeKey) {
    super(key);
    this.__footnoteId = footnoteId;
    this.__format = 0;
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
    return $createFootnoteNode(serializedNode.footnoteId).setFormat(serializedNode.format ?? 0);
  }

  exportJSON(): SerializedFootnoteNode {
    return {
      type: 'footnote',
      version: 1,
      footnoteId: this.__footnoteId,
      format: this.__format,
    };
  }

  // Mirrors TextNode's format bitmask API so this node can carry
  // bold/italic/strikethrough state through the mdast<->Lexical round-trip.
  getFormat(): number {
    return this.getLatest().__format;
  }

  hasFormat(type: TextFormatType): boolean {
    const formatFlag = TEXT_TYPE_TO_FORMAT[type];
    return (this.getFormat() & formatFlag) !== 0;
  }

  setFormat(format: number): this {
    const self = this.getWritable();
    self.__format = format;
    return self;
  }

  toggleFormat(type: TextFormatType): this {
    const format = this.getFormat();
    const newFormat = toggleTextFormatType(format, type, null);
    return this.setFormat(newFormat);
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
    el.textContent = `[^${this.__footnoteId}]`;
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

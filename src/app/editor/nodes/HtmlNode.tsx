/**
 * HtmlNode — Decorator node that carries raw HTML markup opaquely through
 * the mdast <-> Lexical pipeline for round-trip fidelity. The content is
 * never rendered as live DOM (never assigned via innerHTML) — it is always
 * displayed as inert text, matching the "opaque preservation, not live
 * rendering" scope decision for issue #909.
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

export type SerializedHtmlNode = Spread<
  {
    html: string;
    inline: boolean;
  },
  SerializedLexicalNode
>;

function $convertHtmlElement(domNode: HTMLElement): DOMConversionOutput | null {
  const encoded = domNode.getAttribute('data-lexical-html');
  const inline = domNode.getAttribute('data-lexical-inline') === 'true';
  if (encoded === null) {
    return null;
  }
  const html = atob(encoded);
  return { node: $createHtmlNode(html, inline) };
}

export class HtmlNode extends DecoratorNode<JSX.Element> {
  __html: string;
  __inline: boolean;

  static getType(): string {
    return 'html';
  }

  static clone(node: HtmlNode): HtmlNode {
    return new HtmlNode(node.__html, node.__inline, node.__key);
  }

  constructor(html: string, inline?: boolean, key?: NodeKey) {
    super(key);
    this.__html = html;
    this.__inline = inline ?? false;
  }

  static importJSON(serializedNode: SerializedHtmlNode): HtmlNode {
    return $createHtmlNode(serializedNode.html, serializedNode.inline);
  }

  exportJSON(): SerializedHtmlNode {
    return {
      type: 'html',
      version: 1,
      html: this.getHtml(),
      inline: this.__inline,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.className = 'editor-raw-html';
    element.textContent = this.__html;
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    // Encode as base64 to avoid attribute-escaping issues with copy/paste
    element.setAttribute('data-lexical-html', btoa(this.__html));
    element.setAttribute('data-lexical-inline', `${this.__inline}`);
    element.textContent = this.__html;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-html')) {
          return null;
        }
        return { conversion: $convertHtmlElement, priority: 2 };
      },
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-html')) {
          return null;
        }
        return { conversion: $convertHtmlElement, priority: 1 };
      },
    };
  }

  updateDOM(prevNode: HtmlNode): boolean {
    return this.__inline !== prevNode.__inline || this.__html !== prevNode.__html;
  }

  getTextContent(): string {
    return this.__html;
  }

  getHtml(): string {
    return this.__html;
  }

  setHtml(html: string): void {
    const writable = this.getWritable();
    writable.__html = html;
  }

  isInline(): boolean {
    return this.__inline;
  }

  decorate(): JSX.Element {
    return createElement(this.__inline ? 'span' : 'div', { className: 'editor-raw-html' }, this.__html);
  }
}

export function $createHtmlNode(html: string, inline = false): HtmlNode {
  return $applyNodeReplacement(new HtmlNode(html, inline));
}

export function $isHtmlNode(node: LexicalNode | null | undefined): node is HtmlNode {
  return node instanceof HtmlNode;
}

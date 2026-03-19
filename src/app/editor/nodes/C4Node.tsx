/**
 * C4Node - Renders C4 architecture diagrams
 * Uses DecoratorNode pattern similar to MermaidNode
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
import { createElement, lazy, Suspense } from 'react';

const C4Component = lazy(() => import('./C4Component'));

export type SerializedC4Node = Spread<
  {
    code: string;
  },
  SerializedLexicalNode
>;

function $convertC4Element(
  domNode: HTMLElement,
): null | DOMConversionOutput {
  const code = domNode.getAttribute('data-lexical-c4');
  if (code) {
    // Decode from base64
    const decodedCode = atob(code);
    const node = $createC4Node(decodedCode);
    return { node };
  }
  return null;
}

export class C4Node extends DecoratorNode<JSX.Element> {
  __code: string;

  static getType(): string {
    return 'c4';
  }

  static clone(node: C4Node): C4Node {
    return new C4Node(node.__code, node.__key);
  }

  constructor(code: string, key?: NodeKey) {
    super(key);
    this.__code = code;
  }

  static importJSON(serializedNode: SerializedC4Node): C4Node {
    return $createC4Node(serializedNode.code);
  }

  exportJSON(): SerializedC4Node {
    return {
      type: 'c4',
      version: 1,
      code: this.getCode(),
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'editor-c4';
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    // Encode as base64 to avoid issues with special characters
    element.setAttribute('data-lexical-c4', btoa(this.__code));
    element.className = 'c4-export';
    element.textContent = this.__code;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-c4')) {
          return null;
        }
        return {
          conversion: $convertC4Element,
          priority: 2,
        };
      },
    };
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  getTextContent(): string {
    return this.__code;
  }

  getCode(): string {
    return this.__code;
  }

  setCode(code: string): void {
    const writable = this.getWritable();
    writable.__code = code;
  }

  decorate(): JSX.Element {
    return createElement(
      Suspense,
      { fallback: createElement('div', { className: 'c4-loading' }, 'Loading diagram...') },
      createElement(C4Component, {
        code: this.__code,
        nodeKey: this.__key,
      })
    );
  }
}

export function $createC4Node(code = ''): C4Node {
  const c4Node = new C4Node(code);
  return $applyNodeReplacement(c4Node);
}

export function $isC4Node(
  node: LexicalNode | null | undefined,
): node is C4Node {
  return node instanceof C4Node;
}

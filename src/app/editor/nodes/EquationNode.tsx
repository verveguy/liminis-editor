/* eslint-disable react-refresh/only-export-components */
/**
 * EquationNode - Renders LaTeX math equations using KaTeX
 * Ported from Lexical playground with modifications for SlashMD
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
import { createElement, lazy, Suspense } from 'react';
import { createLiteAdaptorDocument } from '../../../mathjax-config';

// Lightweight MathJax instance for DOM export (copy/paste serialization)
const { adaptor: exportAdaptor, document: exportDocument } = createLiteAdaptorDocument({ fontCache: 'none' });

const EquationComponent = lazy(() => import('./EquationComponent'));

export type SerializedEquationNode = Spread<
  {
    equation: string;
    inline: boolean;
    format?: number;
    strongMarker?: '_' | '*' | null;
    emphasisMarker?: '_' | '*' | null;
  },
  SerializedLexicalNode
>;

function $convertEquationElement(
  domNode: HTMLElement,
): null | DOMConversionOutput {
  let equation = domNode.getAttribute('data-lexical-equation');
  const inline = domNode.getAttribute('data-lexical-inline') === 'true';
  // Decode the equation from base64
  equation = atob(equation || '');
  if (equation) {
    const node = $createEquationNode(equation, inline);
    return { node };
  }
  return null;
}

export class EquationNode extends DecoratorNode<JSX.Element> {
  __equation: string;
  __inline: boolean;
  __format: number;
  __strongMarker: '_' | '*' | null;
  __emphasisMarker: '_' | '*' | null;

  static getType(): string {
    return 'equation';
  }

  static clone(node: EquationNode): EquationNode {
    const cloned = new EquationNode(node.__equation, node.__inline, node.__key);
    cloned.__format = node.__format;
    cloned.__strongMarker = node.__strongMarker;
    cloned.__emphasisMarker = node.__emphasisMarker;
    return cloned;
  }

  constructor(equation: string, inline?: boolean, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline ?? false;
    this.__format = 0;
    this.__strongMarker = null;
    this.__emphasisMarker = null;
  }

  static importJSON(serializedNode: SerializedEquationNode): EquationNode {
    const node = $createEquationNode(
      serializedNode.equation,
      serializedNode.inline,
    ).setFormat(serializedNode.format ?? 0);
    if (serializedNode.strongMarker) {
      node.setStrongMarker(serializedNode.strongMarker);
    }
    if (serializedNode.emphasisMarker) {
      node.setEmphasisMarker(serializedNode.emphasisMarker);
    }
    return node;
  }

  exportJSON(): SerializedEquationNode {
    return {
      type: 'equation',
      version: 1,
      equation: this.getEquation(),
      inline: this.__inline,
      format: this.__format,
      strongMarker: this.__strongMarker,
      emphasisMarker: this.__emphasisMarker,
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

  // Mirrors TextNode's --md-strong-marker/--md-emphasis-marker style hooks
  // (via setMarkdownMarker/getMarkdownMarker in the mappers) so a bare
  // `_$O(n)$_`/`__$O(n)__` span with no text sibling can still recover its
  // original underscore-vs-asterisk marker on export.
  getStrongMarker(): '_' | '*' | null {
    return this.getLatest().__strongMarker;
  }

  setStrongMarker(marker: '_' | '*' | null): this {
    const self = this.getWritable();
    self.__strongMarker = marker;
    return self;
  }

  getEmphasisMarker(): '_' | '*' | null {
    return this.getLatest().__emphasisMarker;
  }

  setEmphasisMarker(marker: '_' | '*' | null): this {
    const self = this.getWritable();
    self.__emphasisMarker = marker;
    return self;
  }

  createDOM(): HTMLElement {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    element.className = 'editor-equation';
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? 'span' : 'div');
    // Encode the equation as base64 to avoid issues with special characters
    const equation = btoa(this.__equation);
    element.setAttribute('data-lexical-equation', equation);
    element.setAttribute('data-lexical-inline', `${this.__inline}`);
    try {
      const node = exportDocument.convert(this.__equation, { display: !this.__inline });
      element.innerHTML = exportAdaptor.innerHTML(node);
    } catch {
      element.textContent = this.__equation;
    }
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-equation')) {
          return null;
        }
        return {
          conversion: $convertEquationElement,
          priority: 2,
        };
      },
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-equation')) {
          return null;
        }
        return {
          conversion: $convertEquationElement,
          priority: 1,
        };
      },
    };
  }

  updateDOM(prevNode: EquationNode): boolean {
    return this.__inline !== prevNode.__inline;
  }

  getTextContent(): string {
    return this.__equation;
  }

  getEquation(): string {
    return this.__equation;
  }

  setEquation(equation: string): void {
    const writable = this.getWritable();
    writable.__equation = equation;
  }

  isInline(): boolean {
    return this.__inline;
  }

  decorate(): JSX.Element {
    return createElement(
      Suspense,
      { fallback: null },
      createElement(EquationComponent, {
        equation: this.__equation,
        inline: this.__inline,
        nodeKey: this.__key,
      })
    );
  }
}

export function $createEquationNode(
  equation = '',
  inline = false,
): EquationNode {
  const equationNode = new EquationNode(equation, inline);
  return $applyNodeReplacement(equationNode);
}

export function $isEquationNode(
  node: LexicalNode | null | undefined,
): node is EquationNode {
  return node instanceof EquationNode;
}

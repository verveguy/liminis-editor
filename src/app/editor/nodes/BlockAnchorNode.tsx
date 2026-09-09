/**
 * BlockAnchorNode — Inline decorator node for a block anchor (`^ULID`, #122).
 * Renders a compact badge at the anchor's definition site instead of the raw
 * `^ULID` text, and preserves the id for byte-identical round-trip back to
 * markdown (`stringify.ts`'s `blockAnchor` handler emits `^` + this id, and
 * nothing else).
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
import BlockAnchorComponent from './BlockAnchorComponent';

// ---------------------------------------------------------------------------
// Serialized type
// ---------------------------------------------------------------------------

export type SerializedBlockAnchorNode = Spread<
  {
    id: string;
    format?: number;
    strongMarker?: '_' | '*' | null;
    emphasisMarker?: '_' | '*' | null;
  },
  SerializedLexicalNode
>;

// ---------------------------------------------------------------------------
// DOM conversion (copy/paste support)
// ---------------------------------------------------------------------------

function $convertBlockAnchorElement(domNode: HTMLElement): DOMConversionOutput | null {
  const id = domNode.getAttribute('data-block-anchor-id');
  if (id) {
    return { node: $createBlockAnchorNode(id) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// BlockAnchorNode
// ---------------------------------------------------------------------------

export class BlockAnchorNode extends DecoratorNode<JSX.Element> {
  __id: string;
  __format: number;
  __strongMarker: '_' | '*' | null;
  __emphasisMarker: '_' | '*' | null;

  static getType(): string {
    return 'blockAnchor';
  }

  static clone(node: BlockAnchorNode): BlockAnchorNode {
    const cloned = new BlockAnchorNode(node.__id, node.__key);
    cloned.__format = node.__format;
    cloned.__strongMarker = node.__strongMarker;
    cloned.__emphasisMarker = node.__emphasisMarker;
    return cloned;
  }

  constructor(id: string, key?: NodeKey) {
    super(key);
    this.__id = id;
    this.__format = 0;
    this.__strongMarker = null;
    this.__emphasisMarker = null;
  }

  getId(): string {
    return this.__id;
  }

  // Inline node — sits within text flow
  isInline(): boolean {
    return true;
  }

  // Serialization
  static importJSON(serializedNode: SerializedBlockAnchorNode): BlockAnchorNode {
    const node = $createBlockAnchorNode(serializedNode.id).setFormat(serializedNode.format ?? 0);
    if (serializedNode.strongMarker) {
      node.setStrongMarker(serializedNode.strongMarker);
    }
    if (serializedNode.emphasisMarker) {
      node.setEmphasisMarker(serializedNode.emphasisMarker);
    }
    return node;
  }

  exportJSON(): SerializedBlockAnchorNode {
    return {
      type: 'blockAnchor',
      version: 1,
      id: this.__id,
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
  // anchor sitting inside `**bold**`/`_italic_` still round-trips its
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

  // DOM creation (editor view)
  createDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'block-anchor';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  // DOM export (copy/paste)
  exportDOM(): DOMExportOutput {
    const el = document.createElement('span');
    el.setAttribute('data-block-anchor-id', this.__id);
    el.textContent = `^${this.__id}`;
    return { element: el };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-block-anchor-id')) return null;
        return { conversion: $convertBlockAnchorElement, priority: 1 };
      },
    };
  }

  // Render as React element
  decorate(): JSX.Element {
    return createElement(BlockAnchorComponent, { id: this.__id });
  }
}

// ---------------------------------------------------------------------------
// Factory + type guard
// ---------------------------------------------------------------------------

export function $createBlockAnchorNode(id: string): BlockAnchorNode {
  return $applyNodeReplacement(new BlockAnchorNode(id));
}

export function $isBlockAnchorNode(node: LexicalNode | null | undefined): node is BlockAnchorNode {
  return node instanceof BlockAnchorNode;
}

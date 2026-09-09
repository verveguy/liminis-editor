/* eslint-disable react-refresh/only-export-components */
/**
 * TransclusionNode - Live-rendered block transclusion (`![[file#^id]]`, #119)
 *
 * An **inline** DecoratorNode, unlike the block-level `MermaidNode`: a
 * `wikiEmbed` mdast node is phrasing content (same family as `wikiLink`/
 * `image`), so this matches where it actually sits in the tree rather than
 * forcing paragraph-promotion logic to accommodate it.
 *
 * `file`/`blockId` are the sole identity the node carries; `alias` is stored
 * only for byte-identical round-trip (`![[file#^id|alias]]`) — an embed
 * renders the resolved block's *live content*, never the alias text, so
 * nothing here displays it. Content resolution is async and host-resolver-
 * driven (see `transclusion-render.tsx`), so — mirroring `MermaidNode` — the
 * actual resolver call happens inside the lazily-loaded `TransclusionComponent`
 * at decorate-time, not here: this node is a static, serializable value.
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
import { renderTransclusionLoading } from './transclusion-loading';

const TransclusionComponent = lazy(() => import('./TransclusionComponent'));

export type SerializedTransclusionNode = Spread<
  {
    file: string;
    blockId: string;
    alias: string | null;
    emptyAlias: boolean;
  },
  SerializedLexicalNode
>;

function $convertTransclusionElement(domNode: HTMLElement): null | DOMConversionOutput {
  const file = domNode.getAttribute('data-lexical-transclusion-file');
  const blockId = domNode.getAttribute('data-lexical-transclusion-block-id');
  if (file && blockId) {
    const alias = domNode.getAttribute('data-lexical-transclusion-alias');
    const emptyAlias = domNode.getAttribute('data-lexical-transclusion-empty-alias') === 'true';
    const node = $createTransclusionNode(file, blockId, alias, emptyAlias);
    return { node };
  }
  return null;
}

export class TransclusionNode extends DecoratorNode<JSX.Element> {
  __file: string;
  __blockId: string;
  __alias: string | null;
  __emptyAlias: boolean;

  static getType(): string {
    return 'transclusion';
  }

  static clone(node: TransclusionNode): TransclusionNode {
    return new TransclusionNode(node.__file, node.__blockId, node.__alias, node.__emptyAlias, node.__key);
  }

  constructor(file: string, blockId: string, alias: string | null = null, emptyAlias = false, key?: NodeKey) {
    super(key);
    this.__file = file;
    this.__blockId = blockId;
    this.__alias = alias;
    this.__emptyAlias = emptyAlias;
  }

  static importJSON(serializedNode: SerializedTransclusionNode): TransclusionNode {
    return $createTransclusionNode(
      serializedNode.file,
      serializedNode.blockId,
      serializedNode.alias,
      serializedNode.emptyAlias,
    );
  }

  exportJSON(): SerializedTransclusionNode {
    return {
      type: 'transclusion',
      version: 1,
      file: this.__file,
      blockId: this.__blockId,
      alias: this.__alias,
      emptyAlias: this.__emptyAlias,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'editor-transclusion';
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.setAttribute('data-lexical-transclusion-file', this.__file);
    element.setAttribute('data-lexical-transclusion-block-id', this.__blockId);
    if (this.__alias !== null) {
      element.setAttribute('data-lexical-transclusion-alias', this.__alias);
    }
    if (this.__emptyAlias) {
      element.setAttribute('data-lexical-transclusion-empty-alias', 'true');
    }
    element.className = 'transclusion-export';
    // Never crash a copy/paste-shaped export by trying to resolve content
    // synchronously (FR-008) — a plain placeholder is a faithful, inert
    // stand-in for the live view this node otherwise renders.
    element.textContent = renderPlaceholderText(this.__file, this.__blockId);
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-transclusion-file')) {
          return null;
        }
        return {
          conversion: $convertTransclusionElement,
          priority: 2,
        };
      },
    };
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  getFile(): string {
    return this.__file;
  }

  getBlockId(): string {
    return this.__blockId;
  }

  getAlias(): string | null {
    return this.__alias;
  }

  setAlias(alias: string | null): void {
    const writable = this.getWritable();
    writable.__alias = alias;
  }

  getEmptyAlias(): boolean {
    return this.__emptyAlias;
  }

  setEmptyAlias(emptyAlias: boolean): void {
    const writable = this.getWritable();
    writable.__emptyAlias = emptyAlias;
  }

  decorate(): JSX.Element {
    return createElement(
      Suspense,
      { fallback: renderTransclusionLoading() },
      createElement(TransclusionComponent, {
        file: this.__file,
        blockId: this.__blockId,
        nodeKey: this.__key,
      }),
    );
  }
}

function renderPlaceholderText(file: string, blockId: string): string {
  return `![[${file}#^${blockId}]]`;
}

export function $createTransclusionNode(
  file: string,
  blockId: string,
  alias: string | null = null,
  emptyAlias = false,
): TransclusionNode {
  return $applyNodeReplacement(new TransclusionNode(file, blockId, alias, emptyAlias));
}

export function $isTransclusionNode(node: LexicalNode | null | undefined): node is TransclusionNode {
  return node instanceof TransclusionNode;
}

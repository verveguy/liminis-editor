import { LinkNode, SerializedLinkNode } from '@lexical/link';
import { DOMConversionMap, DOMConversionOutput, EditorConfig, LexicalNode } from 'lexical';

export type SerializedCustomLinkNode = SerializedLinkNode & {
  wikiAliasState?: 'empty';
};

/**
 * CustomLinkNode - Extends Lexical's LinkNode to prevent VS Code webview link interception
 *
 * The standard LinkNode renders `<a href="...">` which VS Code webviews intercept and
 * open automatically on click. This custom node renders `<a data-href="...">` instead,
 * allowing us to control navigation via JavaScript (Cmd+click to open).
 */
export class CustomLinkNode extends LinkNode {
  /** @internal */
  __wikiAliasState: 'empty' | null;

  constructor(
    url: string,
    attributes?: { rel?: null | string; target?: null | string; title?: null | string },
    key?: string
  ) {
    super(url, attributes, key);
    this.__wikiAliasState = null;
  }

  static getType(): string {
    return 'link';  // Use same type to replace the default LinkNode
  }

  static clone(node: CustomLinkNode): CustomLinkNode {
    const cloned = new CustomLinkNode(
      node.__url,
      { rel: node.__rel, target: node.__target, title: node.__title },
      node.__key
    );
    cloned.__wikiAliasState = node.__wikiAliasState;
    return cloned;
  }

  createDOM(config: EditorConfig): HTMLAnchorElement {
    void config;
    const element = document.createElement('a');
    // Store URL in data-href instead of href to prevent webview interception
    element.setAttribute('data-href', this.__url);
    if (this.__target !== null) {
      element.target = this.__target;
    }
    if (this.__rel !== null) {
      element.rel = this.__rel;
    }
    if (this.__title !== null) {
      element.title = this.__title;
    }
    // Add visual styling class
    element.className = 'editor-link';
    
    // Mark wiki-links (internal .md links) with a data attribute
    // This allows the WikiLinkExistencePlugin to check and style broken links
    if (this.isWikiLink()) {
      element.setAttribute('data-wiki-link', 'true');
      element.setAttribute('data-wiki-target', this.__url);
    }
    return element;
  }
  
  /**
   * Check if this link is a wiki-link (internal markdown file)
   */
  isWikiLink(): boolean {
    const url = this.__url;
    // Wiki-links are internal paths that don't start with http/https/mailto
    // and typically end in .md or have no extension
    return !url.startsWith('http://') && 
           !url.startsWith('https://') && 
           !url.startsWith('mailto:') &&
           !url.startsWith('#');
  }

  updateDOM(
    prevNode: CustomLinkNode,
    anchor: HTMLAnchorElement,
    config: EditorConfig
  ): boolean {
    void config;
    const url = this.__url;
    const target = this.__target;
    const rel = this.__rel;
    const title = this.__title;
    if (url !== prevNode.__url) {
      anchor.setAttribute('data-href', url);
      // Update wiki-link attributes when URL changes
      if (this.isWikiLink()) {
        anchor.setAttribute('data-wiki-link', 'true');
        anchor.setAttribute('data-wiki-target', url);
      } else {
        anchor.removeAttribute('data-wiki-link');
        anchor.removeAttribute('data-wiki-target');
      }
    }
    if (target !== prevNode.__target) {
      if (target) {
        anchor.target = target;
      } else {
        anchor.removeAttribute('target');
      }
    }
    if (rel !== prevNode.__rel) {
      if (rel) {
        anchor.rel = rel;
      } else {
        anchor.removeAttribute('rel');
      }
    }
    if (title !== prevNode.__title) {
      if (title) {
        anchor.title = title;
      } else {
        anchor.removeAttribute('title');
      }
    }
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      a: (node: Node) => {
        void node;
        return {
          conversion: convertAnchorElement,
          priority: 1,
        };
      },
    };
  }

  static importJSON(serializedNode: SerializedCustomLinkNode): CustomLinkNode {
    const node = $createCustomLinkNode(serializedNode.url, {
      rel: serializedNode.rel,
      target: serializedNode.target,
      title: serializedNode.title,
    });
    if (serializedNode.wikiAliasState === 'empty') {
      node.__wikiAliasState = 'empty';
    }
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    node.setDirection(serializedNode.direction);
    return node;
  }

  exportJSON(): SerializedCustomLinkNode {
    return {
      ...super.exportJSON(),
      type: 'link',
      version: 1,
      wikiAliasState: this.__wikiAliasState ?? undefined,
    };
  }

  setWikiAliasState(state: 'empty' | null): void {
    const writable = this.getWritable();
    writable.__wikiAliasState = state;
  }

  getWikiAliasState(): 'empty' | null {
    return this.__wikiAliasState ?? null;
  }
}

function convertAnchorElement(domNode: Node): DOMConversionOutput {
  let node: CustomLinkNode | null = null;
  if (domNode instanceof HTMLAnchorElement) {
    // Check data-href first (our custom attribute), then fall back to href
    const url = domNode.getAttribute('data-href') || domNode.getAttribute('href');
    if (url) {
      node = $createCustomLinkNode(url, {
        rel: domNode.getAttribute('rel'),
        target: domNode.getAttribute('target'),
        title: domNode.getAttribute('title'),
      });
    }
  }
  return { node };
}

export function $createCustomLinkNode(
  url: string,
  attributes?: {
    rel?: null | string;
    target?: null | string;
    title?: null | string;
  }
): CustomLinkNode {
  const node = new CustomLinkNode(url, attributes);
  node.__wikiAliasState = null;
  return node;
}

export function $isCustomLinkNode(node: LexicalNode | null | undefined): node is CustomLinkNode {
  return node instanceof CustomLinkNode;
}

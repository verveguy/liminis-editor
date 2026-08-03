import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  LexicalNode,
  SerializedElementNode,
} from 'lexical';

// ==================== DefinitionListNode ====================
// The outer <dl> container, holding a flat sequence of term/description children.

export type SerializedDefinitionListNode = SerializedElementNode;

export class DefinitionListNode extends ElementNode {
  static getType(): string {
    return 'definition-list';
  }

  static clone(node: DefinitionListNode): DefinitionListNode {
    return new DefinitionListNode(node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    return document.createElement('dl');
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      dl: () => ({
        conversion: convertDefinitionListElement,
        priority: 1,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('dl') };
  }

  static importJSON(serializedNode: SerializedDefinitionListNode): DefinitionListNode {
    void serializedNode;
    return $createDefinitionListNode();
  }

  exportJSON(): SerializedDefinitionListNode {
    return {
      ...super.exportJSON(),
      type: 'definition-list',
      version: 1,
    };
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }
}

function convertDefinitionListElement(): DOMConversionOutput | null {
  return { node: $createDefinitionListNode() };
}

export function $createDefinitionListNode(): DefinitionListNode {
  return new DefinitionListNode();
}

export function $isDefinitionListNode(
  node: LexicalNode | null | undefined
): node is DefinitionListNode {
  return node instanceof DefinitionListNode;
}

// ==================== DefinitionTermNode ====================
// A <dt> — holds phrasing content directly, like HeadingNode/ParagraphNode.

export type SerializedDefinitionTermNode = SerializedElementNode;

export class DefinitionTermNode extends ElementNode {
  static getType(): string {
    return 'definition-term';
  }

  static clone(node: DefinitionTermNode): DefinitionTermNode {
    return new DefinitionTermNode(node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    return document.createElement('dt');
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      dt: () => ({
        conversion: convertDefinitionTermElement,
        priority: 1,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('dt') };
  }

  static importJSON(serializedNode: SerializedDefinitionTermNode): DefinitionTermNode {
    void serializedNode;
    return $createDefinitionTermNode();
  }

  exportJSON(): SerializedDefinitionTermNode {
    return {
      ...super.exportJSON(),
      type: 'definition-term',
      version: 1,
    };
  }
}

function convertDefinitionTermElement(): DOMConversionOutput | null {
  return { node: $createDefinitionTermNode() };
}

export function $createDefinitionTermNode(): DefinitionTermNode {
  return new DefinitionTermNode();
}

export function $isDefinitionTermNode(
  node: LexicalNode | null | undefined
): node is DefinitionTermNode {
  return node instanceof DefinitionTermNode;
}

// ==================== DefinitionDescriptionNode ====================
// A <dd> — holds block content (paragraphs), like ToggleContentNode.

export type SerializedDefinitionDescriptionNode = SerializedElementNode;

export class DefinitionDescriptionNode extends ElementNode {
  static getType(): string {
    return 'definition-description';
  }

  static clone(node: DefinitionDescriptionNode): DefinitionDescriptionNode {
    return new DefinitionDescriptionNode(node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    void config;
    return document.createElement('dd');
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      dd: () => ({
        conversion: convertDefinitionDescriptionElement,
        priority: 1,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('dd') };
  }

  static importJSON(serializedNode: SerializedDefinitionDescriptionNode): DefinitionDescriptionNode {
    void serializedNode;
    return $createDefinitionDescriptionNode();
  }

  exportJSON(): SerializedDefinitionDescriptionNode {
    return {
      ...super.exportJSON(),
      type: 'definition-description',
      version: 1,
    };
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }
}

function convertDefinitionDescriptionElement(): DOMConversionOutput | null {
  return { node: $createDefinitionDescriptionNode() };
}

export function $createDefinitionDescriptionNode(): DefinitionDescriptionNode {
  return new DefinitionDescriptionNode();
}

export function $isDefinitionDescriptionNode(
  node: LexicalNode | null | undefined
): node is DefinitionDescriptionNode {
  return node instanceof DefinitionDescriptionNode;
}

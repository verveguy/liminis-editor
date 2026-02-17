import {
  $getRoot,
  $isTextNode,
  $isParagraphNode,
  $isLineBreakNode,
  LexicalEditor,
  LexicalNode,
  TextNode,
  ElementNode,
} from 'lexical';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import { $isListNode, $isListItemNode, ListNode, ListItemNode } from '@lexical/list';
import { $isCodeNode } from '@lexical/code';
import { $isLinkNode } from '@lexical/link';
import { $isTableNode, $isTableRowNode, $isTableCellNode, TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import {
  $isHorizontalRuleNode,
  $isImageNode,
  $isCalloutNode,
  $isToggleContainerNode,
  $isToggleTitleNode,
  $isToggleContentNode,
  $isEquationNode,
  $isMermaidNode,
  $isFrontmatterNode,
  ImageNode,
  CalloutNode,
  ToggleContainerNode,
  EquationNode,
  MermaidNode,
  FrontmatterNode,
} from '../editor/nodes';
import type {
  Root,
  Content,
  PhrasingContent,
  Paragraph,
  Heading,
  Blockquote,
  List,
  ListItem,
  Code,
  ThematicBreak,
  Table,
  TableRow,
  TableCell,
  Image,
  Text,
  Link,
  Html,
  Break,
} from 'mdast';

// Convert Lexical editor state to mdast tree
export function exportLexicalToMdast(editor: LexicalEditor): Root {
  let root: Root = { type: 'root', children: [] };

  editor.getEditorState().read(() => {
    const lexicalRoot = $getRoot();
    const children: Content[] = [];

    for (const child of lexicalRoot.getChildren()) {
      const nodes = convertLexicalNode(child);
      children.push(...nodes);
    }

    root = { type: 'root', children };
  });

  return root;
}

function convertLexicalNode(node: LexicalNode): Content[] {
  if ($isParagraphNode(node)) {
    return [convertParagraphNode(node)];
  }

  if ($isHeadingNode(node)) {
    return [convertHeadingNode(node)];
  }

  if ($isQuoteNode(node)) {
    return [convertQuoteNode(node)];
  }

  if ($isListNode(node)) {
    return [convertListNode(node)];
  }

  // Check FrontmatterNode BEFORE CodeNode since FrontmatterNode extends CodeNode
  if ($isFrontmatterNode(node)) {
    return [convertFrontmatterNode(node)];
  }

  if ($isCodeNode(node)) {
    return [convertCodeNode(node)];
  }

  if ($isHorizontalRuleNode(node)) {
    return [convertHorizontalRuleNode()];
  }

  if ($isTableNode(node)) {
    return [convertTableNode(node)];
  }

  if ($isImageNode(node)) {
    return [convertImageNode(node)];
  }

  if ($isCalloutNode(node)) {
    return [convertCalloutNode(node)];
  }

  if ($isToggleContainerNode(node)) {
    return convertToggleContainerNode(node);
  }

  if ($isEquationNode(node)) {
    return [convertEquationNode(node)];
  }

  if ($isMermaidNode(node)) {
    return [convertMermaidNode(node)];
  }

  // Fallback: create paragraph
  const paragraph: Paragraph = {
    type: 'paragraph',
    children: [{ type: 'text', value: '' }],
  };
  return [paragraph];
}

function convertParagraphNode(node: ElementNode): Paragraph {
  const children = convertInlineChildren(node);
  return {
    type: 'paragraph',
    children: children.length > 0 ? (children as PhrasingContent[]) : [{ type: 'text', value: '' }],
  };
}

function convertHeadingNode(node: ElementNode): Heading {
  const tag = (node as unknown as { getTag: () => string }).getTag();
  const depth = parseInt(tag.charAt(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
  const children = convertInlineChildren(node);

  return {
    type: 'heading',
    depth,
    children: children.length > 0 ? (children as PhrasingContent[]) : [{ type: 'text', value: '' }],
  };
}

function convertQuoteNode(node: ElementNode): Blockquote {
  const paragraph: Paragraph = {
    type: 'paragraph',
    children: convertInlineChildren(node) as PhrasingContent[],
  };

  return {
    type: 'blockquote',
    children: [paragraph],
  };
}

function convertListNode(node: ListNode): List {
  const listType = node.getListType();
  const ordered = listType === 'number';
  const children: ListItem[] = [];

  for (const child of node.getChildren()) {
    if ($isListItemNode(child)) {
      children.push(convertListItemNode(child, ordered));
    }
  }

  return {
    type: 'list',
    ordered,
    spread: false,
    children,
  };
}

function convertListItemNode(node: ListItemNode, _ordered: boolean): ListItem {
  const children: (Paragraph | List)[] = [];
  const inlineChildren: PhrasingContentLike[] = [];

  for (const child of node.getChildren()) {
    if ($isListNode(child)) {
      // Nested list
      if (inlineChildren.length > 0) {
      children.push({ type: 'paragraph', children: [...inlineChildren] as PhrasingContent[] });
        inlineChildren.length = 0;
      }
      children.push(convertListNode(child));
    } else if ($isTextNode(child)) {
      inlineChildren.push(...convertTextNode(child));
    } else if ($isLineBreakNode(child)) {
      inlineChildren.push({ type: 'break' } as Break);
    } else if ($isLinkNode(child)) {
      inlineChildren.push(convertLinkNode(child as unknown as ElementNode));
    }
  }

  if (inlineChildren.length > 0) {
    // Preserve explicit task markers in text to keep round-trip stable.
    // If a list item text already starts with [ ] or [x], we keep it and
    // avoid setting `checked` to prevent duplicate markers on stringify.
    let hasExplicitMarker = false;
    const firstInline = inlineChildren[0];
    if (firstInline?.type === 'text') {
      const textNode = firstInline;
      const match = /^\[( |x|X)\]\s+/.exec(textNode.value);
      if (match) {
        hasExplicitMarker = true;
      }
    }

    children.push({ type: 'paragraph', children: inlineChildren as PhrasingContent[] });

    const checked = node.getChecked?.();
    const checkedForOutput = hasExplicitMarker ? null : checked !== undefined ? checked : null;

    return {
      type: 'listItem',
      spread: false,
      checked: checkedForOutput,
      children: children.length > 0 ? children : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
    };
  }

  return {
    type: 'listItem',
    spread: false,
    checked: node.getChecked?.() !== undefined ? node.getChecked?.() : null,
    children: children.length > 0 ? children : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
  };
}

function convertCodeNode(node: ElementNode): Code {
  // Use getTextContent() which handles both TextNode and CodeHighlightNode children
  const value = node.getTextContent();
  const rawLang = (node as unknown as { getLanguage?: () => string }).getLanguage?.();
  const lang = rawLang && rawLang !== 'plain' ? rawLang : undefined;

  return {
    type: 'code',
    lang,
    value,
  };
}

function convertHorizontalRuleNode(): ThematicBreak {
  return { type: 'thematicBreak' };
}

function convertTableNode(node: TableNode): Table {
  const rows: TableRow[] = [];
  const align: ('left' | 'right' | 'center' | null)[] = [];

  let isFirstRow = true;
  for (const child of node.getChildren()) {
    if ($isTableRowNode(child)) {
      const row = convertTableRowNode(child);
      rows.push(row);

      // Get alignment from first row
      if (isFirstRow) {
        const cellCount = child.getChildren().length;
        for (let i = 0; i < cellCount; i++) {
          align.push(null); // Default alignment
        }
        isFirstRow = false;
      }
    }
  }

  return {
    type: 'table',
    align,
    children: rows,
  };
}

function convertTableRowNode(node: TableRowNode): TableRow {
  const cells: TableCell[] = [];

  for (const child of node.getChildren()) {
    if ($isTableCellNode(child)) {
      cells.push(convertTableCellNode(child));
    }
  }

  return {
    type: 'tableRow',
    children: cells,
  };
}

function convertTableCellNode(node: TableCellNode): TableCell {
  const children: PhrasingContent[] = [];

  for (const child of node.getChildren()) {
    if ($isParagraphNode(child)) {
      children.push(...(convertInlineChildren(child) as PhrasingContent[]));
    }
  }

  return {
    type: 'tableCell',
    children: children.length > 0 ? children : [{ type: 'text', value: '' }],
  };
}

function convertImageNode(node: ImageNode): Paragraph | Html {
  const width = node.getWidth();
  const height = node.getHeight();

  // If image has custom dimensions, output as HTML img tag
  if (width || height) {
    let html = `<img src="${node.getSrc()}" alt="${node.getAlt()}"`;
    if (width) {
      html += ` width="${width}"`;
    }
    if (height) {
      html += ` height="${height}"`;
    }
    if (node.getTitle()) {
      html += ` title="${node.getTitle()}"`;
    }
    html += '>';

    return {
      type: 'html',
      value: html,
    };
  }

  // Standard markdown image syntax
  const image: Image = {
    type: 'image',
    url: node.getSrc(),
    alt: node.getAlt(),
    title: node.getTitle(),
  };

  return {
    type: 'paragraph',
    children: [image],
  };
}

// Math node types from mdast-util-math
interface InlineMath {
  type: 'inlineMath';
  value: string;
}

interface Math {
  type: 'math';
  value: string;
}

function convertEquationNode(node: EquationNode): Paragraph | Math {
  const equation = node.getEquation();
  const isInline = node.isInline();

  if (isInline) {
    // Inline equation: use inlineMath mdast node
    return {
      type: 'paragraph',
      children: [{ type: 'inlineMath', value: equation } as InlineMath as unknown as PhrasingContent],
    };
  }

  // Block equation: use math mdast node
  return {
    type: 'math',
    value: equation,
  } as Math;
}

function convertMermaidNode(node: MermaidNode): Code {
  // Export as a fenced code block with lang="mermaid"
  return {
    type: 'code',
    lang: 'mermaid',
    value: node.getCode(),
  };
}

// YAML frontmatter node type from mdast-util-frontmatter
interface Yaml {
  type: 'yaml';
  value: string;
}

function convertFrontmatterNode(node: FrontmatterNode): Yaml {
  // Export as yaml mdast node (will be serialized as ---\ncontent\n--- by mdast-util-frontmatter)
  return {
    type: 'yaml',
    value: node.getTextContent(),
  };
}

function convertCalloutNode(node: CalloutNode): Blockquote {
  const calloutType = node.getCalloutType().toUpperCase();
  const children: Paragraph[] = [];

  // Iterate through callout's children (paragraphs)
  let isFirst = true;
  for (const child of node.getChildren()) {
    if ($isParagraphNode(child)) {
      const inlineChildren = convertInlineChildren(child);

      if (isFirst) {
        // First paragraph gets the [!TYPE] prefix
        const prefix: Text = { type: 'text', value: `[!${calloutType}]` };
        const contentChildren: PhrasingContentLike[] = [prefix];

        if (inlineChildren.length > 0) {
          // Add newline before content if there is content
          contentChildren.push({ type: 'text', value: '\n' });
          contentChildren.push(...inlineChildren);
        }

        children.push({
          type: 'paragraph',
          children: contentChildren as PhrasingContent[],
        });
        isFirst = false;
      } else {
        // Subsequent paragraphs are added as-is
        children.push({
          type: 'paragraph',
          children: inlineChildren.length > 0 ? (inlineChildren as PhrasingContent[]) : [{ type: 'text', value: '' }],
        });
      }
    }
  }

  // Ensure at least one paragraph with the type marker
  if (children.length === 0) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'text', value: `[!${calloutType}]` }],
    });
  }

  return {
    type: 'blockquote',
    children,
  };
}

function convertToggleContainerNode(node: ToggleContainerNode): Content[] {
  const result: Content[] = [];
  let summaryText = '';
  const contentNodes: Content[] = [];

  // Iterate through children to find title and content
  for (const child of node.getChildren()) {
    if ($isToggleTitleNode(child)) {
      // Extract text from title
      summaryText = child.getTextContent();
    } else if ($isToggleContentNode(child)) {
      // Convert content children to mdast
      const contentNode = child;
      for (const contentChild of contentNode.getChildren()) {
        const converted = convertLexicalNode(contentChild);
        contentNodes.push(...converted);
      }
    }
  }

  // Build the opening HTML tag
  const isOpen = node.getOpen();
  result.push({
    type: 'html',
    value: `<details${isOpen ? ' open' : ''}>\n<summary>${summaryText}</summary>`,
  } as Html);

  // Add all the content nodes (they will be serialized as markdown)
  result.push(...contentNodes);

  // Add the closing tag
  result.push({
    type: 'html',
    value: '\n</details>',
  } as Html);

  return result;
}

function convertInlineChildren(node: ElementNode): PhrasingContentLike[] {
  const children: PhrasingContentLike[] = [];

  for (const child of node.getChildren()) {
    if ($isTextNode(child)) {
      children.push(...convertTextNode(child));
    } else if ($isLineBreakNode(child)) {
      // Soft line break (from trailing double-spaces in markdown)
      children.push({ type: 'break' } as Break);
    } else if ($isLinkNode(child)) {
      children.push(convertLinkNode(child as unknown as ElementNode));
    } else if ($isImageNode(child)) {
      // Handle ImageNode that ended up inside a paragraph (from markdown shortcut)
      // Convert to inline mdast image
      const imageNode = child;
      const image: Image = {
        type: 'image',
        url: imageNode.getSrc(),
        alt: imageNode.getAlt(),
        title: imageNode.getTitle(),
      };
      children.push(image);
    } else if ($isEquationNode(child)) {
      // Handle EquationNode that ended up inside a paragraph (from markdown shortcut)
      // Convert to inlineMath mdast node
      const equationNode = child;
      const equation = equationNode.getEquation();
      children.push({ type: 'inlineMath', value: equation } as InlineMath as unknown as PhrasingContent);
    }
  }

  return children;
}

function convertTextNode(node: TextNode): PhrasingContent[] {
  const text = node.getTextContent();
  const format = node.getFormat();
  const style = node.getStyle() || '';
  const emphasisMarker = getMarkdownMarker(style, '--md-emphasis-marker');
  const strongMarker = getMarkdownMarker(style, '--md-strong-marker');

  if (text === '') {
    return [];
  }

  let result: PhrasingContent = { type: 'text', value: text };

  // Apply formatting
  if (format & 1) {
    // Bold
    result = {
      type: 'strong',
      children: [result] as PhrasingContent[],
      data: strongMarker ? { _strongMarker: strongMarker } : undefined,
    } as PhrasingContent;
  }

  if (format & 2) {
    // Italic
    result = {
      type: 'emphasis',
      children: [result] as PhrasingContent[],
      data: emphasisMarker ? { _emphasisMarker: emphasisMarker } : undefined,
    } as PhrasingContent;
  }

  if (format & 4) {
    // Strikethrough
    result = { type: 'delete', children: [result] as PhrasingContent[] };
  }

  if (format & 16) {
    // Code
    return [{ type: 'inlineCode', value: text }];
  }

  return [result];
}

// Wiki-link node type for mdast-util-wiki-link
interface WikiLinkMdast {
  type: 'wikiLink';
  value: string;
  data?: {
    alias?: string;
    _emptyAlias?: boolean;
    _noAlias?: boolean;
  };
}

type PhrasingContentLike = PhrasingContent | WikiLinkMdast;

// Check if a URL looks like a wiki-link (relative .md path, directory, or anchor, no protocol)
function isWikiLinkUrl(url: string): boolean {
  // Has protocol = not a wiki-link
  if (url.includes('://') || url.startsWith('mailto:')) {
    return false;
  }
  // Anchor-only link = wiki-link
  if (url.startsWith('#')) {
    return true;
  }
  // Directory link (trailing slash) = wiki-link
  // e.g., "entities/teams/" resolves to entities/teams/index.md at navigation time
  if (url.endsWith('/')) {
    return true;
  }
  // Contains .md (possibly with anchor after) = likely a wiki-link
  if (url.includes('.md')) {
    return true;
  }
  return false;
}

/**
 * Format an alias string with markdown format markers based on text format bitmask.
 *
 * Format bitmask values:
 * - 1: bold
 * - 2: italic
 * - 4: strikethrough
 *
 * Order: strikethrough wraps bold wraps italic wraps text
 * e.g., format=7 (all) produces ~~**_text_**~~
 */
export function formatAliasWithMarkers(text: string, format: number): string {
  if (format === 0 || !text) {
    return text;
  }

  let result = text;

  // Apply italic first (innermost)
  if (format & 2) {
    result = `*${result}*`;
  }

  // Then bold
  if (format & 1) {
    result = `**${result}**`;
  }

  // Then strikethrough (outermost)
  if (format & 4) {
    result = `~~${result}~~`;
  }

  return result;
}

function convertLinkNode(node: ElementNode): Link | WikiLinkMdast {
  const url = (node as unknown as { getURL: () => string }).getURL();
  const children: PhrasingContent[] = [];

  for (const child of node.getChildren()) {
    if ($isTextNode(child)) {
      children.push(...convertTextNode(child));
    }
  }

  // Check if this should be a wiki-link
  if (isWikiLinkUrl(url)) {
    // Convert URL back to wiki-link target
    let target: string;

    if (url.startsWith('#')) {
      // Anchor-only: #anchor → #anchor
      target = url;
    } else if (url.includes('.md#')) {
      // Path with anchor: page.md#anchor → page#anchor
      target = url.replace('.md#', '#');
    } else if (url.endsWith('.md')) {
      // Simple path: page.md → page
      target = url.slice(0, -3);
    } else {
      // Fallback: use URL as-is
      target = url;
    }

    // Extract alias and formatting from children
    // Use full text content from all children to avoid data loss with mixed-format aliases
    const displayText = node.getTextContent();
    let textFormat = 0;

    // Use the format of the first TextNode child as the representative format
    const linkChildren = node.getChildren();
    if (linkChildren.length > 0 && $isTextNode(linkChildren[0])) {
      textFormat = linkChildren[0].getFormat();
    }

    const hasAlias = displayText && displayText !== target;
    const aliasState = (node as any).getWikiAliasState?.() ?? null;

    const data: any = {};
    if (hasAlias) {
      // Format the alias with markers if the text has formatting
      data.alias = formatAliasWithMarkers(displayText, textFormat);
    } else if (textFormat !== 0 && displayText) {
      // No alias (displayText === target) but text is formatted
      // We need to create an alias to preserve the formatting
      data.alias = formatAliasWithMarkers(displayText, textFormat);
    } else if (aliasState === 'empty') {
      data._emptyAlias = true;
    } else {
      data._noAlias = true;
    }

    return {
      type: 'wikiLink',
      value: target,
      data,
    };
  }

  return {
    type: 'link',
    url,
    children: children.length > 0 ? children : [{ type: 'text', value: '' }],
  };
}

function getMarkdownMarker(style: string, prop: string): '_' | '*' | null {
  const match = new RegExp(`${prop}\\s*:\\s*([_*])`).exec(style);
  return match ? (match[1] as '_' | '*') : null;
}

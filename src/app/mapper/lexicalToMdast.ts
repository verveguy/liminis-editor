import {
  $getRoot,
  $isTextNode,
  $isParagraphNode,
  $isLineBreakNode,
  LexicalEditor,
  LexicalNode,
  TextNode,
  ElementNode,
  ElementFormatType,
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
  $isC4Node,
  $isFrontmatterNode,
  $isFootnoteNode,
  $isCustomListNode,
  $isDefinitionListNode,
  $isDefinitionTermNode,
  $isDefinitionDescriptionNode,
  $isCustomListItemNode,
  ImageNode,
  CalloutNode,
  ToggleContainerNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  DefinitionListNode,
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
} from 'mdast';
import type { DefListTermNode, DefListDescriptionNode } from 'mdast-util-definition-list';

// Convert Lexical editor state to mdast tree
export function exportLexicalToMdast(editor: LexicalEditor): Root {
  let root: Root = { type: 'root', children: [] };

  editor.getEditorState().read(() => {
    const lexicalRoot = $getRoot();
    const allChildren = lexicalRoot.getChildren();

    // Detect the footnote definitions section appended at the end by mdastToLexical.
    // Pattern: [HR, indented paragraph with FootnoteNode label, ...]
    // These need to be exported as footnoteDefinition MDAST nodes, not plain paragraphs.
    const { bodyChildren, footnoteChildren } = splitFootnoteSection(allChildren);

    const children: Content[] = [];

    for (const child of bodyChildren) {
      const nodes = convertLexicalNode(child);
      children.push(...nodes);
    }

    // Group footnote paragraphs into definitions and convert to MDAST nodes
    for (const fnDef of groupFootnoteChildren(footnoteChildren)) {
      children.push(fnDef);
    }

    root = { type: 'root', children };
  });

  return root;
}

// Detect the trailing footnote definitions section:
// An HR followed by indented paragraphs — each definition starts with a FootnoteNode label,
// and may be followed by continuation paragraphs (indent=1, no FootnoteNode) for multi-paragraph definitions.
function splitFootnoteSection(allChildren: LexicalNode[]): {
  bodyChildren: LexicalNode[];
  footnoteChildren: LexicalNode[];
} {
  // Walk backwards to find the start of the footnote section.
  // Accept any indent=1 paragraph — both labeled (starts with FootnoteNode) and
  // continuation paragraphs (no FootnoteNode, part of a multi-paragraph definition).
  let footnoteStart = allChildren.length;
  let hasLabeledParagraph = false;

  for (let i = allChildren.length - 1; i >= 0; i--) {
    const child = allChildren[i];
    if ($isParagraphNode(child) && child.getIndent() === 1) {
      const firstChild = child.getFirstChild();
      if (firstChild && $isFootnoteNode(firstChild)) {
        hasLabeledParagraph = true;
      }
      footnoteStart = i;
      continue;
    }
    break;
  }

  // Must have at least one paragraph that starts with a FootnoteNode label
  if (!hasLabeledParagraph) {
    return { bodyChildren: allChildren, footnoteChildren: [] };
  }

  // Check if the node just before the footnote paragraphs is an HR separator
  if (footnoteStart < allChildren.length && footnoteStart > 0) {
    const maybeHR = allChildren[footnoteStart - 1];
    if ($isHorizontalRuleNode(maybeHR)) {
      return {
        bodyChildren: allChildren.slice(0, footnoteStart - 1),
        footnoteChildren: allChildren.slice(footnoteStart),
      };
    }
  }

  // No footnote section found
  return { bodyChildren: allChildren, footnoteChildren: [] };
}

// Group consecutive footnote paragraphs into footnoteDefinition MDAST nodes.
// Each labeled paragraph (starts with FootnoteNode) begins a new definition.
// Subsequent unlabeled indent=1 paragraphs are continuation paragraphs of the same definition.
function groupFootnoteChildren(footnoteChildren: LexicalNode[]): Content[] {
  const results: Content[] = [];
  let currentIdentifier: string | null = null;
  let currentParagraphs: Paragraph[] = [];

  function flushDefinition() {
    if (currentIdentifier && currentParagraphs.length > 0) {
      results.push({
        type: 'footnoteDefinition',
        identifier: currentIdentifier,
        label: currentIdentifier,
        children: currentParagraphs,
      } as unknown as Content);
    }
    currentIdentifier = null;
    currentParagraphs = [];
  }

  for (const node of footnoteChildren) {
    if (!$isParagraphNode(node)) continue;

    const firstChild = node.getFirstChild();
    if (firstChild && $isFootnoteNode(firstChild)) {
      // New definition — flush any previous one
      flushDefinition();
      currentIdentifier = firstChild.getFootnoteId();

      // Convert inline content, skipping the FootnoteNode label and its trailing space
      const contentChildren = convertFootnoteInlineChildren(firstChild);
      currentParagraphs.push({
        type: 'paragraph',
        children: contentChildren.length > 0 ? contentChildren : [{ type: 'text', value: '' }],
      });
    } else if (currentIdentifier) {
      // Continuation paragraph for the current definition
      const contentChildren = convertInlineChildren(node) as PhrasingContent[];
      currentParagraphs.push({
        type: 'paragraph',
        children: contentChildren.length > 0 ? contentChildren : [{ type: 'text', value: '' }],
      });
    }
  }

  flushDefinition();
  return results;
}

// Convert inline children of a footnote definition's first paragraph,
// skipping the leading FootnoteNode label and its trailing space separator.
function convertFootnoteInlineChildren(labelNode: LexicalNode): PhrasingContent[] {
  const contentChildren: PhrasingContent[] = [];
  let child = labelNode.getNextSibling();

  // Skip the space TextNode that follows the label
  if (child && $isTextNode(child) && child.getTextContent() === ' ') {
    child = child.getNextSibling();
  }

  // Use the same inline conversion logic as convertInlineChildren
  while (child) {
    if ($isTextNode(child)) {
      contentChildren.push(...convertTextNode(child));
    } else if ($isLineBreakNode(child)) {
      contentChildren.push({ type: 'break' });
    } else if ($isLinkNode(child)) {
      contentChildren.push(convertLinkNode(child) as unknown as PhrasingContent);
    } else if ($isImageNode(child)) {
      const image: Image = {
        type: 'image',
        url: child.getSrc(),
        alt: child.getAlt(),
        title: child.getTitle(),
      };
      contentChildren.push(image);
    } else if ($isEquationNode(child)) {
      contentChildren.push({ type: 'inlineMath', value: child.getEquation() } as unknown as PhrasingContent);
    } else if ($isFootnoteNode(child)) {
      contentChildren.push({
        type: 'footnoteReference',
        identifier: child.getFootnoteId(),
        label: child.getFootnoteId(),
      } as unknown as PhrasingContent);
    }
    child = child.getNextSibling();
  }

  return contentChildren;
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

  if ($isC4Node(node)) {
    return [convertC4Node(node)];
  }

  if ($isDefinitionListNode(node)) {
    return [convertDefinitionListNode(node)];
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
  const spread = $isCustomListNode(node) ? node.getSpread() : false;
  const children: ListItem[] = [];

  for (const child of node.getChildren()) {
    if ($isListItemNode(child)) {
      children.push(convertListItemNode(child, ordered, spread));
    }
  }

  return {
    type: 'list',
    ordered,
    spread,
    children,
  };
}

function convertListItemNode(node: ListItemNode, _ordered: boolean, spread: boolean): ListItem {
  // Mirrors the flush-on-block-boundary dispatch used at the document root
  // (convertLexicalNode): inline children (text/line breaks/links) accumulate
  // into a buffer, which is flushed into a paragraph whenever a nested list or
  // any other block-type child (ParagraphNode, CodeNode, TableNode, QuoteNode,
  // etc.) is encountered. This preserves block content nested inside list
  // items instead of silently dropping it.
  const children: Content[] = [];
  let inlineChildren: PhrasingContentLike[] = [];

  const flushInline = (): void => {
    if (inlineChildren.length > 0) {
      children.push({ type: 'paragraph', children: [...inlineChildren] as PhrasingContent[] });
      inlineChildren = [];
    }
  };

  const kids = node.getChildren();
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];

    if ($isListNode(child)) {
      flushInline();
      children.push(convertListNode(child));
    } else if ($isTextNode(child)) {
      inlineChildren.push(...convertTextNode(child));
    } else if ($isLineBreakNode(child)) {
      // Two consecutive LineBreakNodes mark a paragraph boundary inserted by
      // convertListItem for consecutive mdast paragraphs (see its comment) —
      // flush the current paragraph and start a new one instead of encoding
      // a literal break. Not fully unambiguous — see convertListItem's
      // comment and the `other-list-item-double-hard-break` known-defect
      // fixture for a case this misreads.
      const next = kids[i + 1];
      if (next && $isLineBreakNode(next)) {
        flushInline();
        i++; // consume the marker's second LineBreakNode too
      } else {
        inlineChildren.push({ type: 'break' });
      }
    } else if ($isLinkNode(child)) {
      inlineChildren.push(convertLinkNode(child));
    } else {
      // Any other block-type child (ParagraphNode, CodeNode, TableNode,
      // QuoteNode, etc.) — flush accumulated inline text first, then delegate
      // to the same block dispatcher used at the document root.
      flushInline();
      children.push(...convertLexicalNode(child));
    }
  }
  flushInline();

  // Preserve explicit task markers in text to keep round-trip stable.
  // If a list item's first paragraph already starts with [ ] or [x], keep it
  // and avoid setting `checked` to prevent duplicate markers on stringify.
  let hasExplicitMarker = false;
  const firstChild = children[0];
  if (firstChild?.type === 'paragraph') {
    const firstPhrasing = firstChild.children[0];
    if (firstPhrasing?.type === 'text' && /^\[( |x|X)\]\s+/.exec(firstPhrasing.value)) {
      hasExplicitMarker = true;
    }
  }

  // Stock ListItemNode.getChecked() derives its answer from the parent
  // list's listType ('check' ? Boolean(__checked) : undefined), so it can't
  // distinguish a plain item from an unchecked task when the list is mixed
  // (see CustomListItemNode's docstring). Read the mapper-owned tri-state
  // field instead, which was set directly from mdast on import.
  const checked = $isCustomListItemNode(node) ? node.getTaskChecked() : (node.getChecked?.() ?? null);
  const checkedForOutput = hasExplicitMarker ? null : checked;

  return {
    type: 'listItem',
    // Baseline spread mirrors the containing list's spread (itself carried
    // through the round trip via CustomListNode, preserving the source
    // document's loose/tight intent). stringify.ts's computeListSpread may
    // still upgrade this to true (never downgrade to false) when an item's
    // own child shape requires blank-line separation to parse back
    // unambiguously, regardless of the source document's original spacing.
    spread,
    checked: checkedForOutput,
    children: children.length > 0 ? (children as ListItem['children']) : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
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

function mapFormatTypeToAlign(formatType: ElementFormatType): 'left' | 'right' | 'center' | null {
  switch (formatType) {
    case 'left':
    case 'right':
    case 'center':
      return formatType;
    default:
      return null;
  }
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
        for (const cell of child.getChildren()) {
          if ($isTableCellNode(cell)) {
            align.push(mapFormatTypeToAlign(cell.getFormatType()));
          }
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
      children: [{ type: 'inlineMath', value: equation }],
    };
  }

  // Block equation: use math mdast node
  return {
    type: 'math',
    value: equation,
  };
}

function convertMermaidNode(node: MermaidNode): Code {
  // Export as a fenced code block with lang="mermaid"
  return {
    type: 'code',
    lang: 'mermaid',
    value: node.getCode(),
  };
}

function convertC4Node(node: C4Node): Code {
  // Export as a fenced code block with lang="c4"
  // Persist manual layout positions in the code fence meta field
  const manualLayout = node.getManualLayout();
  const meta = manualLayout && Object.keys(manualLayout.positions).length > 0
    ? '@layout ' + JSON.stringify(manualLayout)
    : undefined;

  return {
    type: 'code',
    lang: 'c4',
    meta: meta ?? null,
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
  });

  // Add all the content nodes (they will be serialized as markdown)
  result.push(...contentNodes);

  // Add the closing tag
  result.push({
    type: 'html',
    value: '\n</details>',
  });

  return result;
}

// Reconstructs a defList/defListTerm/defListDescription mdast node from a
// DefinitionListNode. These node types aren't part of @types/mdast's core
// Content union (mirroring the footnoteDefinition precedent above), so the
// result is cast with `as unknown as Content` at the return site.
function convertDefinitionListNode(node: DefinitionListNode): Content {
  const children: (DefListTermNode | DefListDescriptionNode)[] = [];

  for (const child of node.getChildren()) {
    if ($isDefinitionTermNode(child)) {
      const termChildren = convertInlineChildren(child) as PhrasingContent[];
      children.push({
        type: 'defListTerm',
        children: termChildren.length > 0 ? termChildren : [{ type: 'text', value: '' }],
      } as unknown as DefListTermNode);
    } else if ($isDefinitionDescriptionNode(child)) {
      const descriptionChildren: Content[] = [];
      for (const descriptionChild of child.getChildren()) {
        descriptionChildren.push(...convertLexicalNode(descriptionChild));
      }
      children.push({
        type: 'defListDescription',
        spread: false,
        children: descriptionChildren.length > 0
          ? descriptionChildren
          : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
      } as unknown as DefListDescriptionNode);
    }
  }

  return {
    type: 'defList',
    children,
  } as unknown as Content;
}

function convertInlineChildren(node: ElementNode): PhrasingContentLike[] {
  const children: PhrasingContentLike[] = [];

  for (const child of node.getChildren()) {
    if ($isTextNode(child)) {
      children.push(...convertTextNode(child));
    } else if ($isLineBreakNode(child)) {
      // Soft line break (from trailing double-spaces in markdown)
      children.push({ type: 'break' });
    } else if ($isLinkNode(child)) {
      children.push(convertLinkNode(child));
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
      children.push({ type: 'inlineMath', value: equation });
    } else if ($isFootnoteNode(child)) {
      // Footnote reference: convert back to footnoteReference mdast node
      children.push({
        type: 'footnoteReference',
        identifier: child.getFootnoteId(),
        label: child.getFootnoteId(),
      } as unknown as PhrasingContent);
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
  const linkNode = node as unknown as { getURL: () => string; getTitle: () => string | null };
  const url = linkNode.getURL();
  const children: PhrasingContent[] = [];

  for (const child of node.getChildren()) {
    if ($isTextNode(child)) {
      children.push(...convertTextNode(child));
    } else if ($isImageNode(child)) {
      // Image nested inside a link (the "badge" pattern), e.g. a CI status badge
      children.push({
        type: 'image',
        url: child.getSrc(),
        alt: child.getAlt(),
        title: child.getTitle(),
      });
    } else if ($isLineBreakNode(child)) {
      children.push({ type: 'break' });
    } else if ($isEquationNode(child)) {
      children.push({ type: 'inlineMath', value: child.getEquation() } as unknown as PhrasingContent);
    } else if ($isFootnoteNode(child)) {
      children.push({
        type: 'footnoteReference',
        identifier: child.getFootnoteId(),
        label: child.getFootnoteId(),
      } as unknown as PhrasingContent);
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
    title: linkNode.getTitle(),
    children: children.length > 0 ? children : [{ type: 'text', value: '' }],
  };
}

function getMarkdownMarker(style: string, prop: string): '_' | '*' | null {
  const match = new RegExp(`${prop}\\s*:\\s*([_*])`).exec(style);
  return match ? (match[1] as '_' | '*') : null;
}

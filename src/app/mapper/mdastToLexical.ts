import {
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $getRoot,
  LexicalEditor,
  ParagraphNode,
  TextNode,
  LineBreakNode,
} from 'lexical';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $createListNode, $createListItemNode, ListNode, ListItemNode } from '@lexical/list';
import { $createCodeNode, CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import {
  $createHorizontalRuleNode,
  $createImageNode,
  $createCalloutNode,
  $createToggleContainerNode,
  $createToggleTitleNode,
  $createToggleContentNode,
  $createEquationNode,
  $createMermaidNode,
  $createFrontmatterNode,
  $createCustomLinkNode,
  HorizontalRuleNode,
  ImageNode,
  CalloutNode,
  ToggleContainerNode,
  EquationNode,
  MermaidNode,
  FrontmatterNode,
  CalloutType,
} from '../editor/nodes';
import { $createTableNode, $createTableRowNode, $createTableCellNode, TableNode, TableRowNode, TableCellNode, TableCellHeaderStates } from '@lexical/table';
import type { Root, Content, PhrasingContent, List, ListItem, Table, TableRow, TableCell, Heading, Paragraph, Blockquote, Code, Image, Link, Text, Strong, Emphasis, InlineCode, Delete, Html } from 'mdast';
import DOMPurify from 'dompurify';

type LexicalBlockNode =
  | ParagraphNode
  | HeadingNode
  | QuoteNode
  | ListNode
  | CodeNode
  | HorizontalRuleNode
  | ImageNode
  | CalloutNode
  | ToggleContainerNode
  | TableNode
  | EquationNode
  | MermaidNode
  | FrontmatterNode;

// Convert mdast tree to Lexical editor state
export function importMarkdownToLexical(
  editor: LexicalEditor,
  root: Root
): void {
  editor.update(() => {
    importMarkdownToLexicalInEditorState(root);
  });
}

export function importMarkdownToLexicalInEditorState(root: Root): void {
  const lexicalRoot = $getRoot();
  lexicalRoot.clear();

  // Pre-process: combine details blocks
  const processedChildren = preprocessDetailsBlocks(root.children);

  for (const child of processedChildren) {
    // Check if this is a toggle marker
    if ((child as ToggleContentMarker).type === 'toggle-marker') {
      const nodes = convertToggleMarker(child as ToggleContentMarker);
      for (const node of nodes) {
        lexicalRoot.append(node);
      }
    } else {
      const nodes = convertBlockNode(child as Content);
      for (const node of nodes) {
        lexicalRoot.append(node);
      }
    }
  }
}

// Type for synthetic toggle node that carries mdast content
interface ToggleContentMarker {
  type: 'toggle-marker';
  isOpen: boolean;
  summary: string;
  contentNodes: Content[];
}

// Pre-process mdast children to combine details blocks and preserve content nodes
function preprocessDetailsBlocks(children: Content[]): (Content | ToggleContentMarker)[] {
  const result: (Content | ToggleContentMarker)[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    if (node.type === 'html') {
      const html = node.value.trim();

      // Early exit: skip regex if doesn't start with <details
      if (!html.startsWith('<details') && !html.startsWith('</details')) {
        result.push(node);
        i++;
        continue;
      }

      // Check for opening details tag
      const openingMatch = /<details(?:\s+open)?>\s*<summary>([\s\S]*?)<\/summary>/i.exec(html);
      if (openingMatch) {
        const isOpen = html.toLowerCase().includes('<details open');
        const summary = openingMatch[1].trim();
        const contentNodes: Content[] = [];

        // Collect content nodes until we find the closing tag
        i++;
        while (i < children.length) {
          const innerNode = children[i];
          if (innerNode.type === 'html' && (/<\/details>/i.exec(innerNode.value.trim()))) {
            // Found closing tag
            break;
          }
          // Keep the actual mdast node
          contentNodes.push(innerNode);
          i++;
        }

        // Create a marker that carries the actual mdast nodes
        result.push({
          type: 'toggle-marker',
          isOpen,
          summary,
          contentNodes,
        } as ToggleContentMarker);
        i++; // Skip the closing tag
        continue;
      }

      // Check for complete details block in a single HTML node
      const completeMatch = /<details(?:\s+open)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/i.exec(html);
      if (completeMatch) {
        const isOpen = html.toLowerCase().includes('<details open');
        const summary = completeMatch[1].trim();
        const contentText = completeMatch[2].trim();

        // Create a marker with a paragraph for the text content
        const contentNodes: Content[] = [];
        if (contentText) {
          contentNodes.push({
            type: 'paragraph',
            children: [{ type: 'text', value: contentText }],
          } as Paragraph);
        }

        result.push({
          type: 'toggle-marker',
          isOpen,
          summary,
          contentNodes,
        } as ToggleContentMarker);
        i++;
        continue;
      }
    }

    result.push(node);
    i++;
  }

  return result;
}

function convertBlockNode(node: Content): LexicalBlockNode[] {
  const nodeType = (node as { type: string }).type;
  switch (nodeType) {
    case 'paragraph':
      return convertParagraph(node as Paragraph);
    case 'heading':
      return [convertHeading(node as Heading)];
    case 'blockquote':
      return convertBlockquote(node as Blockquote);
    case 'list':
      return [convertList(node as List)];
    case 'code':
      return [convertCode(node as Code)];
    case 'thematicBreak':
      return [convertThematicBreak()];
    case 'table':
      return [convertTable(node as Table)];
    case 'html':
      return convertHtml(node as Html);
    case 'math':
      // Block math from mdast-util-math: $$...$$
      return [$createEquationNode((node as { value: string }).value, false)];
    case 'inlineMath':
      // Inline math from mdast-util-math: $...$
      // This shouldn't appear at block level, but handle it gracefully
      return [$createEquationNode((node as { value: string }).value, true)];
    case 'yaml': {
      // YAML frontmatter from mdast-util-frontmatter
      const frontmatterNode = $createFrontmatterNode();
      const value = (node as { value: string }).value;
      if (value) {
        frontmatterNode.append($createTextNode(value));
      }
      return [frontmatterNode];
    }
    case 'wikiLink': {
      // Wiki-links appearing at block level (shouldn't happen, but handle gracefully)
      // Wrap in a paragraph with a link
      const wikiLink = node as unknown as { value: string; data?: { alias?: string } };
      const target = wikiLink.value || '';
      const displayText = wikiLink.data?.alias || target;
      const url = target.endsWith('.md') ? target : `${target}.md`;
      
      const paragraph = $createParagraphNode();
      const link = $createCustomLinkNode(url);
      link.append($createTextNode(displayText));
      paragraph.append(link);
      return [paragraph];
    }
    default:
      // For unknown nodes, log a warning and create an empty paragraph
      // Do NOT use String(node) as it produces "[object Object]"
      console.warn('[mdastToLexical] Unknown block node type:', node.type, node);
      const paragraph = $createParagraphNode();
      // Try to extract any text content from the node
      const textContent = (node as { value?: string }).value || '';
      if (textContent) {
        paragraph.append($createTextNode(textContent));
      }
      return [paragraph];
  }
}

function convertParagraph(node: Paragraph): (ParagraphNode | ImageNode)[] {
  // Check if this is just an image - return ImageNode directly
  if (
    node.children.length === 1 &&
    node.children[0].type === 'image'
  ) {
    const img = node.children[0];
    return [$createImageNode(img.url, img.alt || '', img.title ?? undefined)];
  }

  // Check if paragraph contains any images mixed with text
  const hasImages = node.children.some((child: PhrasingContent) => child.type === 'image');
  
  if (!hasImages) {
    // Simple case: no images, just create a paragraph
    const paragraph = $createParagraphNode();
    for (const child of node.children) {
      const nodes = convertInlineNode(child);
      for (const n of nodes) {
        paragraph.append(n);
      }
    }
    return [paragraph];
  }

  // Complex case: mixed text and images
  // Split into multiple blocks: paragraphs for text, ImageNodes for images
  const result: (ParagraphNode | ImageNode)[] = [];
  let currentParagraph: ParagraphNode | null = null;

  for (const child of node.children) {
    if (child.type === 'image') {
      // Flush current paragraph if it has content
      if (currentParagraph && currentParagraph.getTextContent().length > 0) {
        result.push(currentParagraph);
        currentParagraph = null;
      }
      // Add the image as its own block
      const img = child;
      result.push($createImageNode(img.url, img.alt || '', img.title ?? undefined));
    } else {
      // Text or other inline content
      if (!currentParagraph) {
        currentParagraph = $createParagraphNode();
      }
      const nodes = convertInlineNode(child);
      for (const n of nodes) {
        currentParagraph.append(n);
      }
    }
  }

  // Flush any remaining paragraph
  if (currentParagraph && currentParagraph.getTextContent().length > 0) {
    result.push(currentParagraph);
  }

  // If nothing was added (shouldn't happen), return empty paragraph
  if (result.length === 0) {
    return [$createParagraphNode()];
  }

  return result;
}

function convertHeading(node: Heading): HeadingNode {
  const tag = `h${node.depth}` as HeadingTagType;
  const heading = $createHeadingNode(tag);

  for (const child of node.children) {
    const nodes = convertInlineNode(child);
    for (const n of nodes) {
      heading.append(n);
    }
  }

  return heading;
}

function convertBlockquote(node: Blockquote): LexicalBlockNode[] {
  // Check if this is a callout (admonition)
  if (node.children.length > 0) {
    const firstChild = node.children[0];
    if (firstChild.type === 'paragraph' && firstChild.children.length > 0) {
      const firstText = firstChild.children[0];
      if (firstText.type === 'text') {
        const calloutMatch = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.exec(firstText.value);
        if (calloutMatch) {
          const calloutType = calloutMatch[1].toLowerCase() as CalloutType;
          const restOfText = firstText.value.slice(calloutMatch[0].length).trim();

          // Create callout node without initial content
          const callout = $createCalloutNode(calloutType);

          // Create a paragraph for the first line's remaining text and rest of first paragraph
          const firstParagraph = $createParagraphNode();

          if (restOfText) {
            firstParagraph.append($createTextNode(restOfText));
          }

          // Add remaining inline content from the first paragraph
          for (let j = 1; j < firstChild.children.length; j++) {
            const inlineNodes = convertInlineNode(firstChild.children[j]);
            for (const n of inlineNodes) {
              firstParagraph.append(n);
            }
          }

          // Only add the paragraph if it has content
          if (firstParagraph.getTextContent() || firstChild.children.length > 1) {
            callout.append(firstParagraph);
          }

          // Convert remaining children (additional paragraphs, lists, etc.)
          for (let i = 1; i < node.children.length; i++) {
            const child = node.children[i];
            if (child.type === 'paragraph') {
              const p = $createParagraphNode();
              for (const inlineChild of child.children) {
                const nodes = convertInlineNode(inlineChild);
                for (const n of nodes) {
                  p.append(n);
                }
              }
              callout.append(p);
            }
          }

          // Ensure callout has at least one paragraph
          if (callout.getChildrenSize() === 0) {
            callout.append($createParagraphNode());
          }

          return [callout];
        }
      }
    }
  }

  // Regular blockquote
  const quote = $createQuoteNode();

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      for (const inlineChild of child.children) {
        const nodes = convertInlineNode(inlineChild);
        for (const n of nodes) {
          quote.append(n);
        }
      }
    }
  }

  return [quote];
}

function convertList(node: List): ListNode {
  const hasCheckedItems = node.children.some((item: ListItem) => item.checked !== null);
  const listType = node.ordered ? 'number' : hasCheckedItems ? 'check' : 'bullet';
  const list = $createListNode(listType);

  for (const item of node.children) {
    const listItem = convertListItem(item, node);
    list.append(listItem);
  }

  return list;
}

function convertListItem(node: ListItem, parentList: List): ListItemNode {
  // Support checkboxes in both ordered and unordered lists.
  // For unordered lists, we use Lexical's checklist rendering (listType = 'check').
  // For ordered lists, Lexical doesn't render checklists, so we preserve [ ] text.
  const useChecked = parentList.ordered ? undefined : node.checked !== null ? node.checked : undefined;
  const listItem = $createListItemNode(useChecked);

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      // For ordered task lists, prefix the text with [ ] or [x] so it round-trips.
      const shouldPrefixTaskMarker = parentList.ordered && node.checked !== null;
      let prefixed = false;

      for (const inlineChild of child.children) {
        const nodes = convertInlineNode(inlineChild);
        for (const n of nodes) {
          if (!prefixed && shouldPrefixTaskMarker && n instanceof TextNode) {
            const marker = node.checked ? '[x] ' : '[ ] ';
            n.setTextContent(marker + n.getTextContent());
            prefixed = true;
          }
          listItem.append(n);
        }
      }

      // If there were no inline nodes (empty paragraph), still add the marker
      if (!prefixed && shouldPrefixTaskMarker) {
        const marker = node.checked ? '[x] ' : '[ ] ';
        listItem.append($createTextNode(marker));
      }
    } else if (child.type === 'list') {
      // Nested list
      const nestedList = convertList(child);
      listItem.append(nestedList);
    }
  }

  return listItem;
}

function convertCode(node: Code): CodeNode | MermaidNode {
  // Check if this is a mermaid diagram
  if (node.lang === 'mermaid') {
    return $createMermaidNode(node.value);
  }
  
  // If no language was specified, use 'plain' to avoid Lexical defaulting to 'javascript'
  const language = node.lang ? node.lang : 'plain';
  const code = $createCodeNode(language);
  code.append($createTextNode(node.value));
  return code;
}

function convertThematicBreak(): HorizontalRuleNode {
  return $createHorizontalRuleNode();
}

function convertTable(node: Table): TableNode {
  const table = $createTableNode();

  for (let i = 0; i < node.children.length; i++) {
    const row = node.children[i];
    const isHeader = i === 0;
    const tableRow = convertTableRow(row, isHeader, node.align);
    table.append(tableRow);
  }

  return table;
}

function convertTableRow(
  node: TableRow,
  isHeader: boolean,
  alignments: Table['align']
): TableRowNode {
  const row = $createTableRowNode();

  for (let i = 0; i < node.children.length; i++) {
    const cell = node.children[i];
    const align = alignments?.[i] || null;
    const tableCell = convertTableCell(cell, isHeader, align);
    row.append(tableCell);
  }

  return row;
}

function convertTableCell(
  node: TableCell,
  isHeader: boolean,
  _align: 'left' | 'right' | 'center' | null
): TableCellNode {
  const cell = $createTableCellNode(isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);

  const paragraph = $createParagraphNode();
  for (const child of node.children) {
    const nodes = convertInlineNode(child);
    for (const n of nodes) {
      paragraph.append(n);
    }
  }
  cell.append(paragraph);

  return cell;
}

/**
 * SECURITY: Safely parse HTML content using DOMPurify
 * Only allows specific safe tags and attributes
 * 
 * TODO: Current "limited HTML support" only extracts text content from HTML.
 * HTML attributes like align="center" are not rendered. To properly support
 * HTML rendering, consider creating an HtmlBlockNode that safely renders
 * sanitized HTML content while preserving basic styling attributes.
 */
function convertHtml(node: Html): LexicalBlockNode[] {
  const html = node.value.trim();

  // Check for block equation: $$...$$
  const blockEquationMatch = /^\$\$([^$]+)\$\$$/.exec(html);
  if (blockEquationMatch) {
    return [$createEquationNode(blockEquationMatch[1].trim(), false)];
  }

  // Check for inline equation: $...$
  const inlineEquationMatch = /^\$([^$]+)\$$/.exec(html);
  if (inlineEquationMatch) {
    return [$createEquationNode(inlineEquationMatch[1].trim(), true)];
  }

  // Toggle/details blocks are handled by preprocessDetailsBlocks
  // This function only handles remaining HTML

  // SECURITY: Sanitize HTML using DOMPurify with allowlist
  // Allows common safe HTML elements for "limited HTML support"
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      // Block elements
      'div', 'p', 'br', 'hr',
      // Inline formatting
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
      'sub', 'sup', 'mark', 'small',
      // Semantic elements
      'kbd', 'code', 'samp', 'var', 'abbr', 'cite', 'q',
      // Media
      'img',
      // Spans for styling
      'span',
    ],
    ALLOWED_ATTR: [
      'src', 'alt', 'title', 'width', 'height',
      'align', 'class', 'id',
    ],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  // If sanitization removed everything, treat as unknown HTML
  if (!sanitized.trim()) {
    // For unknown/unsafe HTML, create a code block to preserve it visually
    const code = $createCodeNode('html');
    code.append($createTextNode(html));
    return [code];
  }

  // Parse sanitized HTML with proper DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'text/html');

  // Check for img element
  const imgElement = doc.querySelector('img');
  if (imgElement) {
    const src = imgElement.getAttribute('src');
    if (src) {
      const imageNode = $createImageNode(
        src,
        imgElement.getAttribute('alt') || '',
        imgElement.getAttribute('title') || undefined
      );

      const width = imgElement.getAttribute('width');
      const height = imgElement.getAttribute('height');

      if (width) {
        const widthNum = parseInt(width, 10);
        if (!isNaN(widthNum) && widthNum > 0) {
          imageNode.setWidth(widthNum);
        }
      }
      if (height) {
        const heightNum = parseInt(height, 10);
        if (!isNaN(heightNum) && heightNum > 0) {
          imageNode.setHeight(heightNum);
        }
      }

      return [imageNode];
    }
  }

  // Check for hr element
  const hrElement = doc.querySelector('hr');
  if (hrElement) {
    return [$createHorizontalRuleNode()];
  }

  // Check for br element (standalone line break)
  if (sanitized.trim() === '<br>' || sanitized.trim() === '<br/>') {
    const paragraph = $createParagraphNode();
    return [paragraph];
  }

  // For other allowed HTML, render as paragraph with text content
  // This provides basic HTML support while maintaining security
  const textContent = doc.body.textContent || '';
  if (textContent.trim()) {
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(textContent));
    return [paragraph];
  }

  // For empty or unhandled HTML, create a code block to preserve it
  const code = $createCodeNode('html');
  code.append($createTextNode(html));
  return [code];
}

// Convert a toggle marker (from preprocessDetailsBlocks) to Lexical nodes
function convertToggleMarker(marker: ToggleContentMarker): ToggleContainerNode[] {
  const container = $createToggleContainerNode(marker.isOpen);

  // Create title node with the summary text
  const title = $createToggleTitleNode();
  const titleParagraph = $createParagraphNode();
  if (marker.summary) {
    titleParagraph.append($createTextNode(marker.summary));
  }
  title.append(titleParagraph);
  container.append(title);

  // Create content node with all the content blocks
  const content = $createToggleContentNode();

  if (marker.contentNodes.length === 0) {
    // Add an empty paragraph if no content
    content.append($createParagraphNode());
  } else {
    // Convert each content node to Lexical nodes
    for (const contentNode of marker.contentNodes) {
      const lexicalNodes = convertBlockNode(contentNode);
      for (const node of lexicalNodes) {
        content.append(node);
      }
    }
  }

  container.append(content);
  return [container];
}

// Wiki-link node type from mdast-util-wiki-link
interface WikiLink {
  type: 'wikiLink';
  value: string;
  data?: {
    alias?: string;
    permalink?: string;
  };
}

function convertInlineNode(node: PhrasingContent): (TextNode | LinkNode | EquationNode | LineBreakNode)[] {
  // Defensive: handle null/undefined nodes
  if (!node?.type) {
    console.warn('[mdastToLexical] convertInlineNode received invalid node:', node);
    return [$createTextNode('')];
  }

  const nodeType = (node as { type: string }).type;
  switch (nodeType) {
    case 'text':
      return [convertText(node as Text)];
    case 'strong':
      return convertStrong(node as Strong);
    case 'emphasis':
      return convertEmphasis(node as Emphasis);
    case 'inlineCode':
      return [convertInlineCode(node as InlineCode)];
    case 'link':
      return [convertLink(node as Link)];
    case 'delete':
      return convertDelete(node as Delete);
    case 'break':
      // Soft line break from trailing double-spaces in markdown
      return [$createLineBreakNode()];
    case 'image': {
      const imageNode = node as Image;
      // Images in inline context become text placeholder
      return [$createTextNode(`![${imageNode.alt || ''}](${imageNode.url})`)];
    }
    case 'inlineMath':
      // Inline math from mdast-util-math: $...$
      return [$createEquationNode((node as { value: string }).value, true)];
    case 'wikiLink': {
      // Wiki-links from mdast-util-wiki-link: [[path|alias]]
      const wikiLink = node as unknown as WikiLink;
      const target = wikiLink.value;
      
      // Defensive: handle undefined/null target
      if (!target) {
        console.warn('[mdastToLexical] wikiLink with undefined target:', wikiLink);
        return [$createTextNode('[[]]')];
      }
      
      const displayText = wikiLink.data?.alias || target;
      
      // Convert to URL, preserving semantic intent
      // Directory links (trailing slash) are preserved - navigation layer resolves them
      // Example: [[entities/people/]] → stays as entities/people/ (resolved to index.md at navigation time)
      let url: string;
      if (target.startsWith('#')) {
        // Anchor-only: #anchor → #anchor
        url = target;
      } else if (target.endsWith('/')) {
        // Directory link: preserve trailing slash for semantic clarity
        // Navigation layer will resolve to index.md or README.md
        url = target;
      } else if (target.includes('#')) {
        // Path with anchor: page#anchor → page.md#anchor (or dir/#anchor preserved)
        const [path, anchor] = target.split('#', 2);
        if (path.endsWith('/')) {
          // Directory with anchor - preserve for navigation layer
          url = target;
        } else {
          const pathWithExt = path.endsWith('.md') ? path : `${path}.md`;
          url = `${pathWithExt}#${anchor}`;
        }
      } else {
        // Simple path: page → page.md
        url = target.endsWith('.md') ? target : `${target}.md`;
      }
      
      const link = $createCustomLinkNode(url);
      // Preserve empty-alias state for round-trip
      if ((wikiLink as any).data?._emptyAlias) {
        link.setWikiAliasState('empty');
      }
      link.append($createTextNode(displayText));
      return [link];
    }
    case 'html': {
      // Check for inline equation: $...$
      const html = (node as Html).value;
      const inlineEquationMatch = /^\$([^$]+)\$$/.exec(html);
      if (inlineEquationMatch) {
        return [$createEquationNode(inlineEquationMatch[1].trim(), true)];
      }
      // Check for block equation: $$...$$ (shouldn't be inline, but handle gracefully)
      const blockEquationMatch = /^\$\$([^$]+)\$\$$/.exec(html);
      if (blockEquationMatch) {
        return [$createEquationNode(blockEquationMatch[1].trim(), false)];
      }
      // Other HTML becomes plain text
      return [$createTextNode(html)];
    }
    default:
      return [$createTextNode('')];
  }
}

function convertText(node: Text): TextNode {
  return $createTextNode(node.value);
}

function convertStrong(node: Strong): TextNode[] {
  const nodes: TextNode[] = [];
  const marker = (node as any).data?._strongMarker;
  for (const child of node.children) {
    const converted = convertInlineNode(child);
    for (const n of converted) {
      if (n instanceof TextNode) {
        if (!n.hasFormat('bold')) {
          n.toggleFormat('bold');
        }
        setMarkdownMarker(n, 'strong', marker);
        nodes.push(n);
      }
    }
  }
  return nodes;
}

function convertEmphasis(node: Emphasis): TextNode[] {
  const nodes: TextNode[] = [];
  const marker = (node as any).data?._emphasisMarker;
  for (const child of node.children) {
    const converted = convertInlineNode(child);
    for (const n of converted) {
      if (n instanceof TextNode) {
        if (!n.hasFormat('italic')) {
          n.toggleFormat('italic');
        }
        setMarkdownMarker(n, 'emphasis', marker);
        nodes.push(n);
      }
    }
  }
  return nodes;
}

function setMarkdownMarker(node: TextNode, kind: 'emphasis' | 'strong', marker: '_' | '*' | undefined): void {
  if (marker !== '_' && marker !== '*') {
    return;
  }
  const prop = kind === 'emphasis' ? '--md-emphasis-marker' : '--md-strong-marker';
  const style = node.getStyle() || '';
  const pattern = new RegExp(`${prop}\\s*:\\s*[_*]\\s*;?`);
  const entry = `${prop}:${marker};`;
  const nextStyle = pattern.test(style)
    ? style.replace(pattern, entry)
    : style.length > 0 && !style.trim().endsWith(';')
      ? `${style};${entry}`
      : `${style}${entry}`;
  node.setStyle(nextStyle);
}

function convertInlineCode(node: InlineCode): TextNode {
  const textNode = $createTextNode(node.value);
  textNode.setFormat('code');
  return textNode;
}

function convertLink(node: Link): LinkNode {
  const link = $createCustomLinkNode(node.url);

  for (const child of node.children) {
    const nodes = convertInlineNode(child);
    for (const n of nodes) {
      link.append(n);
    }
  }

  return link;
}

function convertDelete(node: Delete): TextNode[] {
  const nodes: TextNode[] = [];
  for (const child of node.children) {
    const converted = convertInlineNode(child);
    for (const n of converted) {
      if (n instanceof TextNode) {
        n.setFormat('strikethrough');
        nodes.push(n);
      }
    }
  }
  return nodes;
}

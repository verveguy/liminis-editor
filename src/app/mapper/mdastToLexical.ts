import {
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $isLineBreakNode,
  $getRoot,
  LexicalEditor,
  ParagraphNode,
  TextNode,
  LineBreakNode,
} from 'lexical';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from '@lexical/rich-text';
import type { ListNode } from '@lexical/list';
import { $createCodeNode, CodeNode } from '@lexical/code';
import { LinkNode, $isLinkNode } from '@lexical/link';
import type { TextFormatType } from 'lexical';
import {
  $createHorizontalRuleNode,
  $createImageNode,
  $isImageNode,
  $createCalloutNode,
  $createToggleContainerNode,
  $createToggleTitleNode,
  $createToggleContentNode,
  $createEquationNode,
  $isEquationNode,
  $createFootnoteNode,
  $isFootnoteNode,
  $createHtmlNode,
  $isHtmlNode,
  $createMermaidNode,
  $createC4Node,
  $createFrontmatterNode,
  $createCustomLinkNode,
  $createCustomListNode,
  $createDefinitionListNode,
  $createDefinitionTermNode,
  $createDefinitionDescriptionNode,
  $createCustomListItemNode,
  $createListItemParagraphBreakNode,
  HorizontalRuleNode,
  ImageNode,
  CalloutNode,
  ToggleContainerNode,
  EquationNode,
  FootnoteNode,
  HtmlNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  DefinitionListNode,
  CalloutType,
  CustomListItemNode,
} from '../editor/nodes';
import { parseFormattedAlias } from '../editor/MarkdownShortcutsPlugin';
import { $createTableNode, $createTableRowNode, $createTableCellNode, TableNode, TableRowNode, TableCellNode, TableCellHeaderStates } from '@lexical/table';
import type { Root, Content, PhrasingContent, List, ListItem, Table, TableRow, TableCell, Heading, Paragraph, Blockquote, Code, Image, Link, Text, Strong, Emphasis, InlineCode, Delete, Html } from 'mdast';
import type { DefListNode as MdastDefListNode } from 'mdast-util-definition-list';
import { getFileType } from '../../utils/file-types';

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
  | C4Node
  | FrontmatterNode
  | DefinitionListNode
  | HtmlNode;

/**
 * A raw-markdown character range, produced during import, mapped onto the
 * Lexical `TextNode` it became (ADR-077's read pathway). Threaded from each
 * leaf inline mdast node's own `position.offset` — real on-disk offsets, valid
 * only for content that came from this exact parse — so an annotation anchor's
 * `targetText` offset (found via a plain string search of the raw markdown)
 * can be mapped onto the Lexical node to wrap in a live `MarkNode`, with no
 * fuzzy matching needed for content that hasn't changed since it was parsed.
 */
export interface OffsetSpan {
  /** Inclusive start offset into the raw markdown text this document was parsed from. */
  start: number;
  /** Exclusive end offset into the raw markdown text this document was parsed from. */
  end: number;
  /** The Lexical TextNode key whose text content spans this raw-markdown range. */
  nodeKey: string;
}

// Set only while a *WithOffsets import is running, so convertText/convertInlineCode
// can record spans without threading a collector parameter through every one of
// this file's many recursive conversion functions. Lexical updates run their
// updater function synchronously and non-reentrantly, so this is safe: it's
// cleared before the exported functions below return.
let offsetSpanCollector: OffsetSpan[] | null = null;

function recordOffsetSpan(
  position: { start?: { offset?: number }; end?: { offset?: number } } | undefined,
  textNode: TextNode
): void {
  if (!offsetSpanCollector) return;
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  if (start == null || end == null) return;

  // An OffsetSpan is only usable if raw-markdown offsets inside it map to the
  // TextNode's own character offsets one-for-one — the consumer subtracts
  // `span.start` from a raw offset and uses the result as a Lexical text
  // offset directly. mdast's `position` covers the *source* range while
  // `node.value` is the *decoded* text, so any backslash escape or character
  // reference in the span breaks that correspondence:
  //
  //   `a \* b`    → span width 6, node text "a * b" (5)
  //   `a &amp; b` → span width 9, node text "a & b" (5)
  //
  // Past the escape every derived offset is skewed, and an offset near the end
  // lands beyond the node's size. Dropping the span makes placement decline for
  // that text (the anchor stays panel-only) rather than wrap the wrong
  // characters or build a point Lexical rejects — the same "reject rather than
  // mis-place" trade the rest of this pathway makes.
  if (end - start !== textNode.getTextContentSize()) return;

  offsetSpanCollector.push({ start, end, nodeKey: textNode.getKey() });
}

// Convert mdast tree to Lexical editor state
export function importMarkdownToLexical(
  editor: LexicalEditor,
  root: Root
): void {
  editor.update(() => {
    importMarkdownToLexicalInEditorState(root);
  });
}

/**
 * Same conversion as {@link importMarkdownToLexicalInEditorState}, but also
 * returns the {@link OffsetSpan}s recovered from the mdast tree's own
 * `position.offset` data — the annotation read pathway's offset decoration.
 * Must run inside an already-active `editor.update()` (mirrors
 * `importMarkdownToLexicalInEditorState`'s own calling convention).
 */
export function importMarkdownToLexicalInEditorStateWithOffsets(root: Root): OffsetSpan[] {
  const spans: OffsetSpan[] = [];
  const previousCollector = offsetSpanCollector;
  offsetSpanCollector = spans;
  try {
    importMarkdownToLexicalInEditorState(root);
  } finally {
    offsetSpanCollector = previousCollector;
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/** Same as {@link importMarkdownToLexical}, but also returns the recovered {@link OffsetSpan}s. */
export function importMarkdownToLexicalWithOffsets(editor: LexicalEditor, root: Root): OffsetSpan[] {
  let spans: OffsetSpan[] = [];
  editor.update(() => {
    spans = importMarkdownToLexicalInEditorStateWithOffsets(root);
  });
  return spans;
}

export function importMarkdownToLexicalInEditorState(root: Root): void {
  const lexicalRoot = $getRoot();
  lexicalRoot.clear();

  // Pre-process: combine details blocks
  const processedChildren = preprocessDetailsBlocks(root.children);

  // Pre-process: extract footnote definitions for bottom rendering
  const { processed: childrenWithoutFootnotes, definitions } = preprocessFootnoteDefinitions(processedChildren);

  for (const child of childrenWithoutFootnotes) {
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

  // Append footnote definitions at the end with HR separator
  if (definitions.length > 0) {
    lexicalRoot.append($createHorizontalRuleNode());
    for (const def of definitions) {
      const nodes = convertBlockNode(def);
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
        });
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
          });
        }

        result.push({
          type: 'toggle-marker',
          isOpen,
          summary,
          contentNodes,
        });
        i++;
        continue;
      }
    }

    result.push(node);
    i++;
  }

  return result;
}

// Pre-process mdast children to extract footnote definitions for bottom-of-document rendering
function preprocessFootnoteDefinitions(
  children: (Content | ToggleContentMarker)[]
): { processed: (Content | ToggleContentMarker)[]; definitions: Content[] } {
  const definitions: Content[] = [];

  function extractFromNode(node: Content): Content | null {
    if (node.type === 'footnoteDefinition') {
      definitions.push(node);
      return null; // Remove from tree
    }

    // Recursively process nodes with children (blockquote, list, listItem, etc.)
    if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
      const typedNode = node as Content & { children: Content[] };
      const filteredChildren: Content[] = [];
      let changed = false;
      for (const child of typedNode.children) {
        const result = extractFromNode(child);
        if (result !== null) {
          filteredChildren.push(result);
          if (result !== child) changed = true;
        } else {
          changed = true;
        }
      }
      // Only create a new node if children actually changed
      if (!changed) return node;
      return { ...typedNode, children: filteredChildren } as Content;
    }

    return node;
  }

  const processed: (Content | ToggleContentMarker)[] = [];
  for (const child of children) {
    // Handle toggle markers separately - they have their own contentNodes to process
    if ((child as ToggleContentMarker).type === 'toggle-marker') {
      const marker = child as ToggleContentMarker;
      const filteredContentNodes: Content[] = [];
      for (const contentNode of marker.contentNodes) {
        const result = extractFromNode(contentNode);
        if (result !== null) {
          filteredContentNodes.push(result);
        }
      }
      processed.push({ ...marker, contentNodes: filteredContentNodes });
    } else {
      const result = extractFromNode(child as Content);
      if (result !== null) {
        processed.push(result);
      }
    }
  }

  return { processed, definitions };
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
      const rawDisplayText = wikiLink.data?.alias || target;
      const url = getFileType(target) !== 'unknown' ? target : `${target}.md`;

      const paragraph = $createParagraphNode();
      const link = $createCustomLinkNode(url);
      link.setWikiLinkOrigin(true);
      // Parse format markers in alias (e.g., **bold**, *italic*, ~~strike~~)
      const { text: plainText, formats } = parseFormattedAlias(rawDisplayText);
      const textNode = $createTextNode(plainText);
      for (const format of formats) {
        textNode.toggleFormat(format);
      }
      link.append(textNode);
      paragraph.append(link);
      return [paragraph];
    }
    case 'footnoteDefinition': {
      // Footnote definition: render as indented paragraphs with superscript label.
      // On export, lexicalToMdast detects this pattern (indent=1, starts with FootnoteNode)
      // and reconstructs the footnoteDefinition MDAST node for round-trip preservation.
      const fnDef = node as { identifier: string; label?: string; children: Content[] };
      const results: LexicalBlockNode[] = [];
      let labelAdded = false;
      for (const child of fnDef.children) {
        const nodes = convertBlockNode(child);
        for (const n of nodes) {
          // Prepend footnote label to the first paragraph only
          if (!labelAdded && n.getType() === 'paragraph' && 'getFirstChild' in n) {
            const label = $createFootnoteNode(fnDef.identifier);
            const space = $createTextNode(' ');
            const firstChild = (n as ParagraphNode).getFirstChild();
            if (firstChild) {
              firstChild.insertBefore(space);
              space.insertBefore(label);
            } else {
              (n as ParagraphNode).append(label);
              (n as ParagraphNode).append(space);
            }
            labelAdded = true;
          }
          if ('setIndent' in n && typeof n.setIndent === 'function') {
            n.setIndent(1);
          }
        }
        results.push(...nodes);
      }
      return results;
    }
    case 'defList': {
      // Definition list: build a dedicated DefinitionListNode so the term/description
      // structure survives round-tripping (see lexicalToMdast's convertDefinitionListNode).
      const defListNode = node as unknown as MdastDefListNode;
      const container = $createDefinitionListNode();
      for (const child of defListNode.children) {
        if (child.type === 'defListTerm') {
          const term = $createDefinitionTermNode();
          for (const inlineChild of child.children) {
            for (const n of convertInlineNode(inlineChild)) {
              term.append(n);
            }
          }
          container.append(term);
        } else if (child.type === 'defListDescription') {
          const description = $createDefinitionDescriptionNode();
          for (const contentChild of child.children as Content[]) {
            for (const n of convertBlockNode(contentChild)) {
              description.append(n);
            }
          }
          container.append(description);
        }
      }
      return [container];
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
    return [$createImageNode(img.url, img.alt || '', { title: img.title ?? undefined })];
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
      result.push($createImageNode(img.url, img.alt || '', { title: img.title ?? undefined }));
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
          const restOfText = firstText.value.slice(calloutMatch[0].length).trimStart();

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

  // Regular blockquote — Lexical's QuoteNode is flat (can't nest quotes),
  // so we return the outer quote with its direct paragraph content,
  // then recursively convert nested blockquotes as separate quote nodes.
  const quote = $createQuoteNode();
  const results: LexicalBlockNode[] = [];

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      for (const inlineChild of child.children) {
        const nodes = convertInlineNode(inlineChild);
        for (const n of nodes) {
          quote.append(n);
        }
      }
    } else if (child.type === 'blockquote') {
      // Nested blockquote: convert recursively.
      // Flush the current quote first, then add nested results.
      if (quote.getChildrenSize() > 0 && results.length === 0) {
        results.push(quote);
      }
      const nestedResults = convertBlockquote(child);
      // Indent nested quotes to show depth
      for (const n of nestedResults) {
        if ('setIndent' in n && typeof n.setIndent === 'function') {
          n.setIndent(n.getIndent() + 1);
        }
      }
      results.push(...nestedResults);
    } else {
      // Other block content inside blockquote (lists, code, etc.)
      const blockNodes = convertBlockNode(child);
      for (const n of blockNodes) {
        quote.append(n);
      }
    }
  }

  // If we haven't pushed the quote yet (no nested blockquotes), push it now
  if (results.length === 0) {
    results.push(quote);
  } else if (quote.getChildrenSize() > 0 && !results.includes(quote)) {
    results.unshift(quote);
  }

  return results;
}

function convertList(node: List): ListNode {
  const hasCheckedItems = node.children.some((item: ListItem) => item.checked !== null);
  const listType = node.ordered ? 'number' : hasCheckedItems ? 'check' : 'bullet';
  const list = $createCustomListNode(listType);
  list.setSpread(node.spread === true);

  for (const item of node.children) {
    const listItem = convertListItem(item, node);
    list.append(listItem);
  }

  return list;
}

function convertListItem(node: ListItem, parentList: List): CustomListItemNode {
  // Support checkboxes in both ordered and unordered lists.
  // For unordered lists, we use Lexical's checklist rendering (listType = 'check').
  // For ordered lists, Lexical doesn't render checklists, so we preserve [ ] text.
  const useChecked = parentList.ordered ? undefined : node.checked !== null ? node.checked : undefined;
  const listItem = $createCustomListItemNode(useChecked);
  // mdast's own tri-state `checked` is the true per-item source of truth,
  // independent of useChecked (which is deliberately always undefined for
  // ordered items) and independent of the parent list's listType (which
  // Lexical's stock getChecked() incorrectly gates on) — see
  // CustomListItemNode's docstring for why this must not be derived from
  // Lexical's own checkbox state.
  listItem.setTaskChecked(node.checked ?? null);

  // For ordered task lists, prefix the text with [ ] or [x] so it round-trips.
  // Only the item's first paragraph gets the marker.
  const shouldPrefixTaskMarker = parentList.ordered && node.checked !== null;
  let isFirstParagraph = true;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    if (child.type === 'paragraph') {
      // @lexical/list's ListItemNode.append() unwraps a directly-appended
      // ParagraphNode, merging its inline content flat onto the item — so a
      // lone paragraph already flattens correctly with no extra work needed.
      // But two consecutive paragraphs with nothing else between them would
      // then merge into one run of text with no separator. Mark that boundary
      // with a single ListItemParagraphBreakNode (a dedicated node type,
      // unambiguous with LineBreakNode by construction — see #902) before
      // flattening this paragraph's content, and detect it again on export to
      // split back into two paragraphs.
      if (node.children[i - 1]?.type === 'paragraph') {
        listItem.append($createListItemParagraphBreakNode());
      }

      const shouldPrefixThisParagraph = isFirstParagraph && shouldPrefixTaskMarker;

      // Prepend the marker as its own TextNode before any inline content,
      // rather than splicing it into the first TextNode found — the first
      // inline child isn't always a TextNode (e.g. a link or emphasis run),
      // and splicing into whichever TextNode appears first misplaces the
      // marker mid-paragraph instead of at its start.
      if (shouldPrefixThisParagraph) {
        const marker = node.checked ? '[x] ' : '[ ] ';
        listItem.append($createTextNode(marker));
      }

      for (const inlineChild of child.children) {
        const nodes = convertInlineNode(inlineChild);
        for (const n of nodes) {
          listItem.append(n);
        }
      }

      isFirstParagraph = false;
    } else if (child.type === 'list') {
      // Nested list
      const nestedList = convertList(child);
      listItem.append(nestedList);
    } else {
      // Other block content inside list items (blockquotes, code, tables, etc.)
      const blockNodes = convertBlockNode(child);
      for (const n of blockNodes) {
        listItem.append(n);
      }
    }
  }

  return listItem;
}

function convertCode(node: Code): CodeNode | MermaidNode | C4Node {
  // Check if this is a mermaid diagram
  if (node.lang === 'mermaid') {
    return $createMermaidNode(node.value);
  }

  // Check if this is a C4 architecture diagram
  if (node.lang === 'c4' || (node.lang === 'plantuml' && isC4PlantUML(node.value))) {
    const manualLayout = extractC4LayoutFromMeta(node.meta);
    return $createC4Node(node.value, manualLayout);
  }

  // If no language was specified, use 'plain' to avoid Lexical defaulting to 'javascript'
  const language = node.lang ? node.lang : 'plain';
  const code = $createCodeNode(language);
  code.append($createTextNode(node.value));
  return code;
}

/** Detect C4-PlantUML content inside a plantuml code block */
const C4_MACRO_PATTERN = /\b(?:Person|System|Container|Component|Boundary|Rel|BiRel)(?:_Ext|Db|Queue|_Boundary)?\s*[(_]/;
function isC4PlantUML(code: string): boolean {
  return C4_MACRO_PATTERN.test(code);
}

/** Extract and validate manual layout data from a C4 code fence's meta string */
function extractC4LayoutFromMeta(meta: string | null | undefined): import('../editor/c4/types').ManualLayout | undefined {
  if (!meta?.startsWith('@layout ')) return undefined;
  try {
    const raw = JSON.parse(meta.slice('@layout '.length));
    if (!raw || typeof raw !== 'object') return undefined;
    const positions = raw.positions;
    if (!positions || typeof positions !== 'object') return undefined;
    for (const key of Object.keys(positions)) {
      const pos = positions[key];
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' ||
          !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        return undefined;
      }
    }
    return raw as import('../editor/c4/types').ManualLayout;
  } catch {
    return undefined;
  }
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
  align: 'left' | 'right' | 'center' | null
): TableCellNode {
  const cell = $createTableCellNode(isHeader ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);
  cell.setFormat(align ?? '');

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
 * Convert a block-level mdast `html` node. The raw markup is preserved
 * opaquely via HtmlNode for round-trip fidelity (see issue #909) — it is
 * never sanitized or interpreted, only ever displayed as inert text
 * (HtmlNode never assigns to innerHTML).
 *
 * The one exception is a dimensioned `<img>` tag, which is reconstructed as
 * a real, resizable ImageNode — this is a matched, load-bearing pair with
 * convertImageNode's html-reconstruction on export and must not be broken.
 */
function convertHtml(node: Html): LexicalBlockNode[] {
  const html = node.value;
  const trimmed = html.trim();

  // Check for block equation: $$...$$
  const blockEquationMatch = /^\$\$([^$]+)\$\$$/.exec(trimmed);
  if (blockEquationMatch) {
    return [$createEquationNode(blockEquationMatch[1].trim(), false)];
  }

  // Check for inline equation: $...$
  const inlineEquationMatch = /^\$([^$]+)\$$/.exec(trimmed);
  if (inlineEquationMatch) {
    return [$createEquationNode(inlineEquationMatch[1].trim(), true)];
  }

  // Toggle/details blocks are handled by preprocessDetailsBlocks
  // This function only handles remaining HTML

  // Check for a standalone dimensioned <img> tag — reconstructed as a real
  // ImageNode, matching convertImageNode's html-reconstruction on export.
  // Only fires when the <img> is the block's sole content: an <img> nested
  // inside other markup (e.g. a <div> wrapper), or accompanied by a comment
  // or other non-whitespace node, must stay part of the opaque HtmlNode
  // below, not be hoisted out on its own. Checked against childNodes (not
  // just element children) so a sibling <!-- comment --> isn't silently
  // dropped by only counting elements.
  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'text/html');
  const significantChildren = Array.from(doc.body.childNodes).filter(
    (n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim())
  );
  const isStandaloneImg =
    significantChildren.length === 1 &&
    significantChildren[0].nodeType === Node.ELEMENT_NODE &&
    (significantChildren[0] as Element).tagName === 'IMG';
  const imgElement = isStandaloneImg ? (significantChildren[0] as HTMLImageElement) : null;
  if (imgElement) {
    const src = imgElement.getAttribute('src');
    if (src) {
      const imageNode = $createImageNode(
        src,
        imgElement.getAttribute('alt') || '',
        { title: imgElement.getAttribute('title') || undefined }
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

  // Everything else — the untrimmed original value is preserved verbatim,
  // opaquely, for exact byte round-trip regardless of incidental whitespace.
  return [$createHtmlNode(html, false)];
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

function convertInlineNode(node: PhrasingContent): (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] {
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
      // Images nested inline (e.g. the "badge" pattern: an image inside a link)
      // become a real ImageNode child, preserving the image through the round trip.
      return [$createImageNode(imageNode.url, imageNode.alt || '', { title: imageNode.title ?? undefined })];
    }
    case 'inlineMath':
      // Inline math from mdast-util-math: $...$
      return [$createEquationNode((node as { value: string }).value, true)];
    case 'footnoteReference': {
      // Footnote reference: use FootnoteNode to preserve identity for round-trip
      const fnRef = node as unknown as { identifier: string; label?: string };
      return [$createFootnoteNode(fnRef.identifier)];
    }
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
          const pathWithExt = getFileType(path) !== 'unknown' ? path : `${path}.md`;
          url = `${pathWithExt}#${anchor}`;
        }
      } else {
        // Simple path: page → page.md (unless it already has a recognized extension)
        url = getFileType(target) !== 'unknown' ? target : `${target}.md`;
      }
      
      const link = $createCustomLinkNode(url);
      // Marks this link as genuine author-written wiki-link syntax, so export
      // (convertLinkNode) always emits it back as a wiki-link even when a host
      // has disabled promotion of ordinary links (liminis#951).
      link.setWikiLinkOrigin(true);
      // Preserve empty-alias state for round-trip
      if ((wikiLink as any).data?._emptyAlias) {
        link.setWikiAliasState('empty');
      }
      // Parse format markers in alias (e.g., **bold**, *italic*, ~~strike~~)
      const { text: plainText, formats } = parseFormattedAlias(displayText);
      const textNode = $createTextNode(plainText);
      for (const format of formats) {
        textNode.toggleFormat(format);
      }
      link.append(textNode);
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
      // Other inline HTML is preserved opaquely as live markup, not escaped text
      return [$createHtmlNode(html, true)];
    }
    default:
      return [$createTextNode('')];
  }
}

function convertText(node: Text): TextNode {
  const textNode = $createTextNode(node.value);
  recordOffsetSpan(node.position, textNode);
  return textNode;
}

/**
 * Apply a text format to all text children of a LinkNode.
 * This allows formats like bold/italic to propagate through wiki links.
 */
function applyFormatToLinkChildren(
  link: LinkNode,
  format: TextFormatType,
  marker?: '_' | '*'
): void {
  for (const child of link.getChildren()) {
    if (child instanceof TextNode) {
      if (!child.hasFormat(format)) {
        child.toggleFormat(format);
      }
      // Set marker style for round-trip fidelity
      if (marker && (format === 'bold' || format === 'italic')) {
        const kind = format === 'bold' ? 'strong' : 'emphasis';
        setMarkdownMarker(child, kind, marker);
      }
    }
  }
}

function convertStrong(node: Strong): (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] {
  const nodes: (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] = [];
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
      } else if ($isLinkNode(n)) {
        // Apply bold formatting to wiki link's text children
        applyFormatToLinkChildren(n, 'bold', marker);
        nodes.push(n);
      } else if ($isEquationNode(n) || $isFootnoteNode(n)) {
        if (!n.hasFormat('bold')) {
          n.toggleFormat('bold');
        }
        if (marker === '_' || marker === '*') {
          n.setStrongMarker(marker);
        }
        nodes.push(n);
      } else if ($isImageNode(n) || $isHtmlNode(n) || $isLineBreakNode(n)) {
        // These have no bold/italic representation — pass through unformatted
        nodes.push(n);
      }
    }
  }
  return nodes;
}

function convertEmphasis(node: Emphasis): (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] {
  const nodes: (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] = [];
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
      } else if ($isLinkNode(n)) {
        // Apply italic formatting to wiki link's text children
        applyFormatToLinkChildren(n, 'italic', marker);
        nodes.push(n);
      } else if ($isEquationNode(n) || $isFootnoteNode(n)) {
        if (!n.hasFormat('italic')) {
          n.toggleFormat('italic');
        }
        if (marker === '_' || marker === '*') {
          n.setEmphasisMarker(marker);
        }
        nodes.push(n);
      } else if ($isImageNode(n) || $isHtmlNode(n) || $isLineBreakNode(n)) {
        // These have no bold/italic representation — pass through unformatted
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
  recordOffsetSpan(inlineCodeContentPosition(node), textNode);
  return textNode;
}

/**
 * mdast's own `position` for an `inlineCode` node spans the whole code span
 * *including* its backtick fence (e.g. `` `doThing()` ``), but `node.value`
 * (and the `TextNode` built from it) never includes the backticks — so the
 * raw offsets need to be narrowed inward by the fence length before they're
 * usable as an offset->node span. Fences are symmetric (same backtick count
 * on both sides, CommonMark's own rule), so the fence length is recovered
 * from the gap between the position's full width and the content's length.
 */
function inlineCodeContentPosition(node: InlineCode): InlineCode['position'] {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start == null || end == null) return node.position;
  const fenceLength = Math.floor((end - start - node.value.length) / 2);
  if (fenceLength <= 0) return node.position;
  return {
    start: { ...node.position!.start, offset: start + fenceLength },
    end: { ...node.position!.end, offset: end - fenceLength },
  };
}

function convertLink(node: Link): LinkNode {
  const link = $createCustomLinkNode(node.url, { title: node.title ?? undefined });

  for (const child of node.children) {
    const nodes = convertInlineNode(child);
    for (const n of nodes) {
      link.append(n);
    }
  }

  return link;
}

function convertDelete(node: Delete): (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] {
  const nodes: (TextNode | LinkNode | ImageNode | EquationNode | FootnoteNode | HtmlNode | LineBreakNode)[] = [];
  for (const child of node.children) {
    const converted = convertInlineNode(child);
    for (const n of converted) {
      if (n instanceof TextNode) {
        n.setFormat('strikethrough');
        nodes.push(n);
      } else if ($isLinkNode(n)) {
        // Apply strikethrough formatting to wiki link's text children
        applyFormatToLinkChildren(n, 'strikethrough');
        nodes.push(n);
      } else if ($isEquationNode(n) || $isFootnoteNode(n)) {
        if (!n.hasFormat('strikethrough')) {
          n.toggleFormat('strikethrough');
        }
        nodes.push(n);
      } else if ($isImageNode(n) || $isHtmlNode(n) || $isLineBreakNode(n)) {
        // These have no strikethrough representation — pass through unformatted
        nodes.push(n);
      }
    }
  }
  return nodes;
}

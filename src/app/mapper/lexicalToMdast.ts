import {
  $getRoot,
  $isTextNode,
  $isElementNode,
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
import { $isMarkNode, type MarkNode } from '@lexical/mark';
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
  $isHtmlNode,
  $isListItemParagraphBreakNode,
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
    root = exportLexicalToMdastInEditorState();
  });

  return root;
}

/**
 * Same conversion as {@link exportLexicalToMdast}, but callable from within an
 * already-active `editor.update()`/`editor.getEditorState().read()` — mirrors
 * `mdastToLexical.ts`'s `importMarkdownToLexicalInEditorState` convention.
 * Used by the annotated-serialize harvest ({@link setAnnotateTarget}) so it can
 * run inside the same read as the plain export it's paired with, with no
 * nested `.read()` call.
 */
export function exportLexicalToMdastInEditorState(): Root {
  // Refresh the sentinel-boundary maps for this export pass — populated only
  // when annotate mode is on (see setAnnotateTarget); left null otherwise, so
  // the disk-write path (never sets a target) takes on zero overhead and zero
  // behavioral change.
  if (annotateTargetId) {
    collectSentinelLeaves(annotateTargetId);
  } else {
    sentinelBefore = null;
    sentinelAfter = null;
  }

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

  return { type: 'root', children };
}

// ============================================================================
// Mark transparency
// ============================================================================

/**
 * `node.getChildren()`, with any `MarkNode` child (an annotation's live anchor)
 * replaced in place by its own effective children, recursively. A `MarkNode` is
 * a live in-editor wrapper with no markdown representation of its own
 * (ADR-076) — every call site that gathers a block's inline content must see
 * straight through it, so serialization is unaffected by whether any text
 * currently carries an annotation.
 */
function effectiveChildren(node: ElementNode): LexicalNode[] {
  const result: LexicalNode[] = [];
  for (const child of node.getChildren()) {
    if ($isMarkNode(child)) {
      result.push(...effectiveChildren(child));
    } else {
      result.push(child);
    }
  }
  return result;
}

// ============================================================================
// Annotated-serialize mode
//
// A throwaway variant of the export used only by the annotation capture
// primitive (`annotation-marks.ts`'s `locateLiveMarkdownRange`): while a
// target annotation id is set via `setAnnotateTarget`, that id's live
// MarkNode(s) — already transparent to markdown — additionally get their
// content bracketed with a pair of Unicode Private-Use-Area sentinel tokens
// carrying the id. Serializing with this mode on is byte-for-byte identical to
// a normal export *except* for those inserted tokens (no other line of this
// file's conversion logic branches on `annotateTargetId`), so a caller can find
// the id's sentinel tokens in the resulting string and know that: the first
// open token's own position is this mark's real start offset in the *plain*
// export of the same state, and the (sentinel-stripped) text between the
// outermost tokens is the exact raw markdown slice the mark covers — including
// whatever markdown syntax the mark's boundary happens to fall on, which is
// exactly what a search for the mark's *rendered* text could not reliably
// locate. Never enabled on the disk-write path.
// ============================================================================

const SENTINEL_OPEN_START = '';
const SENTINEL_OPEN_END = '';
const SENTINEL_CLOSE_START = '';
const SENTINEL_CLOSE_END = '';

let annotateTargetId: string | null = null;
let sentinelBefore: Map<LexicalNode, string> | null = null;
let sentinelAfter: Map<LexicalNode, string> | null = null;

/** Enables (or, passed `null`, disables) annotated-serialize mode for `id`. See module doc above. */
export function setAnnotateTarget(id: string | null): void {
  annotateTargetId = id;
}

export function markOpenToken(id: string): string {
  return `${SENTINEL_OPEN_START}${id}${SENTINEL_OPEN_END}`;
}

export function markCloseToken(id: string): string {
  return `${SENTINEL_CLOSE_START}${id}${SENTINEL_CLOSE_END}`;
}

/** Every live `MarkNode` in the tree carrying `id`, document order. */
function collectMarksWithId(id: string): MarkNode[] {
  const result: MarkNode[] = [];
  const visit = (node: LexicalNode): void => {
    if ($isMarkNode(node) && node.hasID(id)) {
      result.push(node);
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  visit($getRoot());
  return result;
}

/** First/last text-bearing leaf among `nodes`, recursing into element children (e.g. a link's own text) — never into another mark (handled by the caller's own flattening). */
function firstTextLeaf(nodes: readonly LexicalNode[]): TextNode | null {
  for (const node of nodes) {
    if ($isTextNode(node)) return node;
    if ($isElementNode(node)) {
      const leaf = firstTextLeaf(effectiveChildren(node));
      if (leaf) return leaf;
    }
  }
  return null;
}

function lastTextLeaf(nodes: readonly LexicalNode[]): TextNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if ($isTextNode(node)) return node;
    if ($isElementNode(node)) {
      const leaf = lastTextLeaf(effectiveChildren(node));
      if (leaf) return leaf;
    }
  }
  return null;
}

/**
 * Populates `sentinelBefore`/`sentinelAfter` for every live mark carrying
 * `id`: its own first rendered-text leaf gets an open-token prefix, its own
 * last gets a close-token suffix. A multi-block/multi-mark annotation (several
 * sibling MarkNodes sharing `id`) gets one such pair per mark instance —
 * deliberately, so the caller can recover a per-mark boundary even when the
 * marks aren't textually adjacent.
 */
function collectSentinelLeaves(id: string): void {
  const before = new Map<LexicalNode, string>();
  const after = new Map<LexicalNode, string>();
  for (const mark of collectMarksWithId(id)) {
    const kids = effectiveChildren(mark);
    const first = firstTextLeaf(kids);
    const last = lastTextLeaf(kids);
    if (first) before.set(first, id);
    if (last) after.set(last, id);
  }
  sentinelBefore = before;
  sentinelAfter = after;
}

/** `node`'s own rendered text content, with an annotate-mode sentinel spliced in if this exact node instance is a live mark's boundary leaf. A no-op (returns `node.getTextContent()` verbatim) whenever annotate mode is off. */
function sentinelAugmentedText(node: TextNode): string {
  let text = node.getTextContent();
  const beforeId = sentinelBefore?.get(node);
  if (beforeId) text = markOpenToken(beforeId) + text;
  const afterId = sentinelAfter?.get(node);
  if (afterId) text = text + markCloseToken(afterId);
  return text;
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
      // Through the mark-transparent view, so an annotation wrapping the label
      // itself doesn't hide this paragraph from footnote-section detection.
      const firstChild = effectiveChildren(child)[0];
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

    // Through the mark-transparent view, so an annotation wrapping the label
    // itself doesn't hide this paragraph's own definition identity.
    const firstChild = effectiveChildren(node)[0];
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

  // An annotation wrapping the label itself puts a MarkNode between it and its
  // real block parent — step past any such wrapper(s) so the mark-transparent
  // sibling walk below sees the label's true siblings, not just its mark-mates.
  let parent = labelNode.getParent();
  while (parent && $isMarkNode(parent)) parent = parent.getParent();
  if (!parent) return contentChildren;

  // Walk the label's siblings through the mark-transparent view so an
  // annotation over part of the footnote's own content doesn't hide it.
  const { nodes: siblings, marked } = effectiveChildrenWithMarkMembership(parent);
  const labelIndex = siblings.findIndex((n) => n.is(labelNode));
  let rest: LexicalNode[] = labelIndex === -1 ? [] : siblings.slice(labelIndex + 1);

  // Skip the space TextNode that follows the label
  if (rest[0] && $isTextNode(rest[0]) && rest[0].getTextContent() === ' ') {
    rest = rest.slice(1);
  }

  let restIndex = 0;
  let child: LexicalNode | null = rest[restIndex] ?? null;

  // TextNodes are buffered and flushed through the shared run-merging path, for
  // the same reason convertLinkNode and convertListItemNode do it: a mark that
  // splits a formatted run inside the footnote's body would otherwise emit one
  // delimiter pair per resulting sibling (`**big**** word**`).
  let textRun: LexicalNode[] = [];
  const flushTextRun = (): void => {
    if (textRun.length > 0) {
      contentChildren.push(...(convertInlinePhrasingList(textRun, marked) as PhrasingContent[]));
      textRun = [];
    }
  };

  // Use the same inline conversion logic as convertInlineChildren
  while (child) {
    if ($isTextNode(child)) {
      textRun.push(child);
      restIndex++;
      child = rest[restIndex] ?? null;
      continue;
    }
    flushTextRun();
    if ($isLineBreakNode(child)) {
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
    restIndex++;
    child = rest[restIndex] ?? null;
  }
  flushTextRun();

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

  if ($isHtmlNode(node)) {
    return [{ type: 'html', value: node.getHtml() }];
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
  // Buffers raw TextNodes rather than converting each as it's seen, so a run
  // an annotation mark split is merged on flush by the same logic
  // convertInlineChildren uses — needed here for the same reason.
  let textRun: LexicalNode[] = [];

  const { nodes: listItemChildren, marked } = effectiveChildrenWithMarkMembership(node);

  const flushTextRun = (): void => {
    if (textRun.length > 0) {
      inlineChildren.push(...convertInlinePhrasingList(textRun, marked));
      textRun = [];
    }
  };

  const flushInline = (): void => {
    flushTextRun();
    if (inlineChildren.length > 0) {
      children.push({ type: 'paragraph', children: [...inlineChildren] as PhrasingContent[] });
      inlineChildren = [];
    }
  };

  for (const child of listItemChildren) {
    if ($isListNode(child)) {
      flushInline();
      children.push(convertListNode(child));
    } else if ($isTextNode(child)) {
      textRun.push(child);
    } else if ($isListItemParagraphBreakNode(child)) {
      // Marks a paragraph boundary inserted by convertListItem for consecutive
      // mdast paragraphs (see its comment) — flush the current paragraph and
      // start a new one. A dedicated node type, unambiguous with LineBreakNode
      // by construction, so it never collides with a genuine hard break —
      // see #902.
      flushInline();
    } else if ($isLineBreakNode(child)) {
      flushTextRun();
      inlineChildren.push({ type: 'break' });
    } else if ($isLinkNode(child)) {
      flushTextRun();
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

// Mark-transparent and annotate-mode-aware equivalent of
// `node.getTextContent()`: a fenced code block's own text (concatenating
// CodeHighlightNode/TabNode/LineBreakNode children) plus, for the
// annotate-mode target's boundary leaf, the same sentinel splice every other
// block type gets via `sentinelAugmentedText`. Without this, an annotation
// wrapping part of a code block's content would never be locatable via
// `locateLiveMarkdownRange` — capture would always come back null exactly as
// if there were no live mark at all.
function convertCodeNode(node: ElementNode): Code {
  // Mark-transparent equivalent of getTextContent(), which handles both
  // TextNode and CodeHighlightNode children.
  let value = '';
  for (const child of effectiveChildren(node)) {
    value += $isTextNode(child) ? sentinelAugmentedText(child) : child.getTextContent();
  }
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

// The bold/italic/strikethrough bits of Lexical's TextFormat bitmask.
// (bit 8 = underline, 16 = code, and higher bits aren't representable in markdown here.)
const MERGEABLE_FORMAT_MASK = 1 | 2 | 4;

// Returns the bold/italic/strikethrough bits a child can contribute to a shared
// strong/emphasis/delete wrapper, or null if the child can't participate in one
// (e.g. inline code, or a node type with no format bitmask like images/breaks).
function getMergeableFormat(child: LexicalNode): number | null {
  if ($isTextNode(child)) {
    if (child.hasFormat('code')) {
      return null;
    }
    return child.getFormat() & MERGEABLE_FORMAT_MASK;
  }
  if ($isEquationNode(child) || $isFootnoteNode(child)) {
    return child.getFormat() & MERGEABLE_FORMAT_MASK;
  }
  return null;
}

// Converts a single inline child using the same per-node rules as before this
// issue's fix — no merging, no format wrapper applied here. Used both for
// children that carry no format and for children whose format is already
// handled by convertTextNode (a lone formatted TextNode).
function convertSingleInlineChild(child: LexicalNode): PhrasingContentLike[] {
  if ($isTextNode(child)) {
    return convertTextNode(child);
  } else if ($isLineBreakNode(child)) {
    // Soft line break (from trailing double-spaces in markdown)
    return [{ type: 'break' }];
  } else if ($isLinkNode(child)) {
    return [convertLinkNode(child)];
  } else if ($isImageNode(child)) {
    // Handle ImageNode that ended up inside a paragraph (from markdown shortcut)
    // Convert to inline mdast image
    const image: Image = {
      type: 'image',
      url: child.getSrc(),
      alt: child.getAlt(),
      title: child.getTitle(),
    };
    return [image];
  } else if ($isEquationNode(child)) {
    // Handle EquationNode that ended up inside a paragraph (from markdown shortcut)
    // Convert to inlineMath mdast node
    return [{ type: 'inlineMath', value: child.getEquation() }];
  } else if ($isFootnoteNode(child)) {
    // Footnote reference: convert back to footnoteReference mdast node
    return [{
      type: 'footnoteReference',
      identifier: child.getFootnoteId(),
      label: child.getFootnoteId(),
    } as unknown as PhrasingContent];
  } else if ($isHtmlNode(child)) {
    // Inline HTML preserved opaquely: convert back to a phrasing html mdast node
    return [{ type: 'html', value: child.getHtml() } as unknown as PhrasingContent];
  }
  return [];
}

// Converts a run of consecutive siblings that all share the same non-zero
// bold/italic/strikethrough bits into a single mdast strong/emphasis/delete
// wrapper, so a non-text child (math, footnote reference) in the middle of a
// formatted span doesn't get left outside the marker's boundary.
function convertFormattedRun(runChildren: LexicalNode[], format: number): PhrasingContent {
  const content: PhrasingContent[] = [];
  let strongMarker: '_' | '*' | null = null;
  let emphasisMarker: '_' | '*' | null = null;

  for (const child of runChildren) {
    if ($isTextNode(child)) {
      const text = sentinelAugmentedText(child);
      if (text === '') {
        continue;
      }
      content.push({ type: 'text', value: text });
      const style = child.getStyle() || '';
      strongMarker = strongMarker ?? getMarkdownMarker(style, '--md-strong-marker');
      emphasisMarker = emphasisMarker ?? getMarkdownMarker(style, '--md-emphasis-marker');
    } else if ($isEquationNode(child)) {
      content.push({ type: 'inlineMath', value: child.getEquation() });
      strongMarker = strongMarker ?? child.getStrongMarker();
      emphasisMarker = emphasisMarker ?? child.getEmphasisMarker();
    } else if ($isFootnoteNode(child)) {
      strongMarker = strongMarker ?? child.getStrongMarker();
      emphasisMarker = emphasisMarker ?? child.getEmphasisMarker();
      content.push({
        type: 'footnoteReference',
        identifier: child.getFootnoteId(),
        label: child.getFootnoteId(),
      } as unknown as PhrasingContent);
    }
  }

  return wrapWithFormat(content, format, strongMarker, emphasisMarker);
}

// Nests content in strong/emphasis/delete wrappers matching convertTextNode's
// order: bold innermost, then italic, then strikethrough outermost.
function wrapWithFormat(
  content: PhrasingContent[],
  format: number,
  strongMarker: '_' | '*' | null,
  emphasisMarker: '_' | '*' | null,
): PhrasingContent {
  let result: PhrasingContent[] = content;

  if (format & 1) {
    // Bold
    result = [{
      type: 'strong',
      children: result,
      data: strongMarker ? { _strongMarker: strongMarker } : undefined,
    } as PhrasingContent];
  }

  if (format & 2) {
    // Italic
    result = [{
      type: 'emphasis',
      children: result,
      data: emphasisMarker ? { _emphasisMarker: emphasisMarker } : undefined,
    } as PhrasingContent];
  }

  if (format & 4) {
    // Strikethrough
    result = [{ type: 'delete', children: result }];
  }

  return result[0];
}

/**
 * `effectiveChildren`, additionally reporting which of the returned nodes came
 * out from inside a `MarkNode`.
 *
 * Flattening a mark away can split what was a single same-format `TextNode`
 * into several adjacent same-format siblings. Serialized per-node, that run
 * would emit one marker pair each (`**a****b**` instead of `**ab**`), so merely
 * annotating text would change the markdown — exactly what mark transparency
 * forbids. Merging the run fixes it, but merging unconditionally would also
 * change output for documents with no marks at all, which must stay
 * byte-identical. Knowing which nodes were mark members lets the merge fire
 * only on runs a mark actually touched.
 */
function effectiveChildrenWithMarkMembership(node: ElementNode): {
  nodes: LexicalNode[];
  marked: Set<LexicalNode>;
} {
  const nodes: LexicalNode[] = [];
  const marked = new Set<LexicalNode>();

  const walk = (parent: ElementNode, insideMark: boolean): void => {
    for (const child of parent.getChildren()) {
      if ($isMarkNode(child)) {
        walk(child, true);
      } else {
        nodes.push(child);
        if (insideMark) marked.add(child);
      }
    }
  };
  walk(node, false);

  return { nodes, marked };
}

function convertInlineChildren(node: ElementNode): PhrasingContentLike[] {
  const { nodes, marked } = effectiveChildrenWithMarkMembership(node);
  return convertInlinePhrasingList(nodes, marked);
}

/**
 * Converts a flat list of already-mark-flattened inline Lexical nodes into
 * mdast phrasing content, merging maximal runs of same-format siblings that a
 * mark split apart. Shared by every call site that gathers a run of inline
 * content — paragraphs/headings/etc. (`convertInlineChildren`) and list-item
 * inline runs (`convertListItemNode`) — so both stay mark-transparent.
 */
function convertInlinePhrasingList(
  kids: readonly LexicalNode[],
  marked: ReadonlySet<LexicalNode>,
): PhrasingContentLike[] {
  const children: PhrasingContentLike[] = [];

  let i = 0;
  while (i < kids.length) {
    const child = kids[i];

    // A mark splitting an inline-code span leaves adjacent code-format text
    // siblings, and mdast-util-to-markdown never merges adjacent inlineCode
    // nodes back together (each gets its own backtick pair) — so the run has to
    // be concatenated before conversion.
    if ($isTextNode(child) && child.hasFormat('code')) {
      let j = i + 1;
      let runTouchesMark = marked.has(child);
      while (j < kids.length && $isTextNode(kids[j]) && (kids[j] as TextNode).hasFormat('code')) {
        if (marked.has(kids[j])) runTouchesMark = true;
        j++;
      }
      if (runTouchesMark && j > i + 1) {
        children.push(...convertCodeRun(kids.slice(i, j) as TextNode[]));
        i = j;
        continue;
      }
    }

    const format = getMergeableFormat(child);

    if (format) {
      // Find the maximal run of consecutive siblings sharing this exact
      // format, tracking whether it contains a non-text (math/footnote) node —
      // only those runs need the merged wrapper; all-text runs keep the
      // existing per-node path below (untouched, per FR-006) unless a mark
      // split them, in which case merging is what preserves transparency.
      let j = i + 1;
      let hasNonTextMember = !$isTextNode(child);
      let runTouchesMark = marked.has(child);
      while (j < kids.length && getMergeableFormat(kids[j]) === format) {
        if (!$isTextNode(kids[j])) {
          hasNonTextMember = true;
        }
        if (marked.has(kids[j])) runTouchesMark = true;
        j++;
      }

      if (hasNonTextMember || (runTouchesMark && j > i + 1)) {
        children.push(convertFormattedRun(kids.slice(i, j), format));
        i = j;
        continue;
      }
    }

    children.push(...convertSingleInlineChild(child));
    i++;
  }

  return children;
}

/** Concatenates a run of inline-code TextNodes into a single mdast inlineCode node. */
function convertCodeRun(runChildren: TextNode[]): PhrasingContent[] {
  let text = '';
  for (const child of runChildren) {
    text += sentinelAugmentedText(child);
  }
  if (text === '') return [];
  return [{ type: 'inlineCode', value: text }];
}

function convertTextNode(node: TextNode): PhrasingContent[] {
  const text = sentinelAugmentedText(node);
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

  // Mark-transparent: this loop silently drops any child it doesn't recognize,
  // so an unflattened MarkNode over the link's text would delete that text from
  // the export entirely (`[note](...)` becoming `[](...)`).
  //
  // TextNodes are buffered rather than converted one at a time, then flushed
  // through the shared run-merging path: flattening a mark away can split one
  // formatted TextNode into several same-format siblings, and converting those
  // independently emits a delimiter pair each — `[**abc def**]` becoming
  // `[**abc**** def**]` once an annotation covers only "abc". Same reason
  // convertListItemNode buffers.
  const { nodes: linkChildren, marked } = effectiveChildrenWithMarkMembership(node);
  let textRun: LexicalNode[] = [];
  const flushTextRun = (): void => {
    if (textRun.length > 0) {
      children.push(...(convertInlinePhrasingList(textRun, marked) as PhrasingContent[]));
      textRun = [];
    }
  };

  for (const child of linkChildren) {
    if ($isTextNode(child)) {
      textRun.push(child);
      continue;
    }
    flushTextRun();
    if ($isImageNode(child)) {
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
    } else if ($isHtmlNode(child)) {
      children.push({ type: 'html', value: child.getHtml() } as unknown as PhrasingContent);
    }
  }
  flushTextRun();

  // Check if this should be a wiki-link. A title is a strong signal that the
  // author deliberately used standard markdown link syntax — wiki-link syntax
  // has no title slot, so promoting a titled link would silently drop it.
  if (isWikiLinkUrl(url) && !linkNode.getTitle()) {
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
    // Mark-transparent, so an annotation over the link's text doesn't hide the
    // representative TextNode behind a MarkNode wrapper.
    const linkChildren = effectiveChildren(node);
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

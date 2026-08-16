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
import {
  SENTINEL_CLOSE_END,
  SENTINEL_CLOSE_START,
  SENTINEL_OPEN_END,
  SENTINEL_OPEN_START,
  stripAnnotateSentinels,
} from '../../markdown/annotate-sentinels';

/**
 * Whether an untitled relative link (a `.md` path, `.md` path with anchor, bare
 * `#anchor`, or directory-style path — see `isWikiLinkUrl`) is promoted to
 * wiki-link syntax (`[[target]]` / `[[target|alias]]`) on export, or emitted as
 * a standard markdown link (`[text](target)`). `'promote'` (the default)
 * reproduces the pipeline's only historical behavior; `'off'` is for a
 * consumer whose documents are rendered by something that doesn't understand
 * wiki-link syntax (e.g. the GitHub web UI — liminis#951).
 *
 * Never affects a **titled** link, which is never promoted regardless of this
 * setting (liminis#919), or wiki-link *parsing* on import, which this setting
 * does not touch at all.
 */
export type WikiLinkPromotionMode = 'promote' | 'off';

export interface ExportOptions {
  /** @default 'promote' */
  wikiLinkPromotion?: WikiLinkPromotionMode;
}

// Convert Lexical editor state to mdast tree
export function exportLexicalToMdast(editor: LexicalEditor, options: ExportOptions = {}): Root {
  let root: Root = { type: 'root', children: [] };

  editor.getEditorState().read(() => {
    root = exportLexicalToMdastInEditorState(options);
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
export function exportLexicalToMdastInEditorState(options: ExportOptions = {}): Root {
  // Read once per export pass into the module-level variable `convertLinkNode`
  // consults — mirrors the `annotateTargetId` precedent below (safe under the
  // same synchronous, non-reentrant discipline: this function is the sole
  // entry point every caller funnels through, and it returns before any other
  // export could start).
  wikiLinkPromotionMode = options.wikiLinkPromotion ?? 'promote';

  // Refresh the sentinel-boundary maps for this export pass — populated only
  // when annotate mode is on (see setAnnotateTarget); left null otherwise, so
  // the disk-write path (never sets a target) takes on zero overhead and zero
  // behavioral change.
  if (annotateTargetId) {
    collectSentinelPlacements(annotateTargetId);
  } else {
    sentinelBefore = null;
    sentinelAfter = null;
    hoistedBefore = null;
    hoistedAfter = null;
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
 * (ADR-077) — every call site that gathers a block's inline content must see
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
// carrying the id (see `markdown/annotate-sentinels.ts`). Serializing with this
// mode on is byte-for-byte identical to a normal export *except* for those
// inserted tokens, so a caller can find the id's sentinel tokens in the
// resulting string and know that: the first open token's own position is this
// mark's real start offset in the *plain* export of the same state, and the
// (sentinel-stripped) text between the outermost tokens is the exact raw
// markdown slice the mark covers — including whatever markdown syntax the
// mark's boundary happens to fall on, which is exactly what a search for the
// mark's *rendered* text could not reliably locate. Never enabled on the
// disk-write path.
//
// That "identical except for the tokens" property is load-bearing and is *not*
// self-evident from the code: it holds only because no conversion decision
// anywhere reads a text value the tokens have been spliced into. Two did, and
// silently perturbed unrelated output until `annotated-serialize-corpus.test.ts`
// pinned the property corpus-wide (Liminis #970); both now go through
// `stripAnnotateSentinels` first. Any new decision made from a text value
// carries the same obligation.
//
// Where a token *lands* is not simply "the boundary text leaf". A token spliced
// into a leaf that sits inside an inline construct would put the recovered range
// inside that construct's syntax — a mark over `it [rests](https://example.com)`
// recovered as `it [rests`, a slice ending mid-link that a host then wrote back
// as the annotation's stored target (#970, defect 2). So a boundary abutting an
// inline construct whose whole content the mark covers is *hoisted* outside it
// and emitted as its own mdast text node beside the construct. See
// `collectSentinelPlacements` and `hoistTargetAt` for the exact rule, and why
// partial coverage deliberately does not hoist.
// ============================================================================

let annotateTargetId: string | null = null;
// Tokens spliced *into* a boundary text leaf's own value.
let sentinelBefore: Map<LexicalNode, string> | null = null;
let sentinelAfter: Map<LexicalNode, string> | null = null;
// Tokens emitted as their own mdast text node *outside* a wholly-covered inline
// construct — keyed on the node that begins (resp. ends) that construct. See
// `collectSentinelPlacements`.
let hoistedBefore: Map<LexicalNode, string> | null = null;
let hoistedAfter: Map<LexicalNode, string> | null = null;

// Set once per export pass by exportLexicalToMdastInEditorState (see its own
// comment); read only by convertLinkNode's promotion check below.
let wikiLinkPromotionMode: WikiLinkPromotionMode = 'promote';

/**
 * Enables (or, passed `null`, disables) annotated-serialize mode for `id`. See module doc above.
 *
 * These three are module-level globals shared by every `Editor` instance in the
 * process, not per-editor state. That is safe only because the one caller
 * (`annotation-marks.ts`'s `exportAnnotatedMarkdown`) does set → export →
 * `finally`-reset entirely synchronously, so two captures can never interleave
 * in a single-threaded runtime — but nothing about the signature enforces it,
 * and multiple `<Editor>`s can legitimately coexist (multi-pane). If a future
 * change ever made any part of the annotate-mode export path async, or reused
 * this from a second call site, two captures would silently corrupt each
 * other's sentinel state and produce a wrong anchor range with no signal that
 * anything went wrong (review finding, @handarbeit-pruefer).
 *
 * So the invariant is asserted rather than assumed: enabling while already
 * enabled throws. A crash naming the problem beats a silently wrong anchor.
 */
export function setAnnotateTarget(id: string | null): void {
  if (id !== null && annotateTargetId !== null) {
    throw new Error(
      `setAnnotateTarget("${id}") while annotate mode is already active for "${annotateTargetId}" — ` +
        'annotated serialization uses module-level sentinel state and is not re-entrant. ' +
        'The export path must stay synchronous, with exactly one caller at a time.',
    );
  }
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
 * The mark-flattened phrasing run a mark's own children sit inside, plus where
 * in it they sit — i.e. the list `convertInlinePhrasingList` will actually see,
 * and the mark's index range within it.
 *
 * Null when the mark has no children, or when its (mark-transparent) parent is
 * one whose inline content does *not* go through the shared phrasing path —
 * see {@link canCarryHoistedTokens}.
 */
function markPhrasingContext(mark: MarkNode): { flat: LexicalNode[]; first: number; last: number } | null {
  let parent = mark.getParent();
  while (parent && $isMarkNode(parent)) parent = parent.getParent();
  if (!parent || !$isElementNode(parent) || !canCarryHoistedTokens(parent)) return null;

  const kids = effectiveChildren(mark);
  if (kids.length === 0) return null;
  const flat = effectiveChildren(parent);
  const first = flat.findIndex((node) => node.is(kids[0]));
  const last = flat.findIndex((node) => node.is(kids[kids.length - 1]));
  if (first === -1 || last === -1 || last < first) return null;
  return { flat, first, last };
}

/**
 * An inline node that emits markdown syntax of its own around (or instead of)
 * text — a link, wiki link, image, inline equation, footnote reference or
 * inline HTML. When one of these is a mark's own child it is *wholly* inside
 * that mark by construction, so the mark's boundary token belongs outside the
 * whole construct rather than inside its text.
 *
 * Line breaks are excluded deliberately: they carry no syntax a boundary can
 * fall inside, and today's leaf walk skips straight past them.
 */
function isHoistableConstruct(node: LexicalNode): boolean {
  return $isLinkNode(node) || $isImageNode(node) || $isEquationNode(node) || $isFootnoteNode(node) || $isHtmlNode(node);
}

/**
 * Inclusive bounds of the maximal run of consecutive siblings in `flat` that
 * will be emitted inside one shared delimiter pair with `flat[index]` — the
 * same runs `convertInlinePhrasingList` merges (inline code, and
 * strong/emphasis/delete, including a run whose members' formats differ but
 * share a common bit — see `convertInlineUnit`). Null when `flat[index]`
 * carries no such delimiters.
 */
function mergeableRunBounds(flat: readonly LexicalNode[], index: number): { start: number; end: number } | null {
  const child = flat[index];
  if (!$isTextNode(child)) return null;

  // Pure inline code only. A code-formatted node that also carries a
  // bold/italic/strikethrough bit is emitted inside that wrapper (#973), so its
  // delimiter run is the *formatted* run computed below, not the code run —
  // getting this precedence wrong misplaces annotate-mode sentinel hoisting.
  if (child.hasFormat('code') && !getMergeableFormat(child)) {
    const isCode = (node: LexicalNode): boolean =>
      $isTextNode(node) && node.hasFormat('code') && !getMergeableFormat(node);
    let start = index;
    let end = index;
    while (start > 0 && isCode(flat[start - 1])) start--;
    while (end + 1 < flat.length && isCode(flat[end + 1])) end++;
    return { start, end };
  }

  const format = getMergeableFormat(child);
  if (!format) return null;

  // Replays `convertInlineUnit`'s own shrinking-intersection scan, left to
  // right from the start of `flat`, and returns the bounds of whichever
  // partition segment contains `index`.
  //
  // A symmetric/bidirectional scan centered on `index` (the original version
  // of this code) is only equivalent to that forward partition for a
  // *uniform* run — one where every member's format is exactly equal, so the
  // running intersection never actually shrinks and boundary order can't
  // matter. Once a run's members can differ-but-overlap (the bold/bold+italic
  // /bold split produced by a nested `**bold _and italic_**`), the partition
  // becomes direction-sensitive: which run a node belongs to depends on where
  // that run *started* scanning forward, which a scan centered on `index`
  // cannot recover just by looking at `index`'s own neighbors. A prior version
  // of this function got this wrong for an asymmetric transition like
  // italic(2)/bold+italic(3)/bold(1): querying the last (bold) node walked
  // left into the middle node and returned a run of the last two nodes, while
  // `convertInlineUnit`'s actual forward-computed unit for that same middle
  // node is the *first* two — a fictitious run that happened to still satisfy
  // `hoistTargetAt`'s "wholly inside the mark" gate, hoisting an annotation
  // sentinel out past content the mark never covered (PR #16 review).
  let i = 0;
  while (i <= index) {
    const startFormat = getMergeableFormat(flat[i]);
    if (startFormat === null || startFormat === 0) {
      i++;
      continue;
    }
    let common = startFormat;
    let j = i + 1;
    while (j < flat.length) {
      const nextFormat = getMergeableFormat(flat[j]);
      if (nextFormat === null || (nextFormat & common) === 0) break;
      common &= nextFormat;
      j++;
    }
    if (index < j) return { start: i, end: j - 1 };
    i = j;
  }
  return { start: index, end: index };
}

/**
 * Whether `node` is the entirety of `parent`'s mark-flattened content — i.e.
 * everything `parent` will emit comes from inside `node`.
 */
function coversAllOf(node: LexicalNode, parent: ElementNode): boolean {
  const outer = effectiveChildren(parent);
  const inner = $isMarkNode(node) ? effectiveChildren(node) : [node];
  return outer.length === inner.length && outer.every((child, index) => child.is(inner[index]));
}

/**
 * Walking *outward* from `mark`: the outermost inline construct whose whole
 * text the mark covers, or null if the mark sits inside no such construct.
 *
 * This is the case where the mark is *inside* the construct rather than around
 * it — a selection of exactly a link's own text, which is what every ordinary
 * DOM capture over a link produces, and what a markdown-domain anchor over a
 * whole link resolves to (both endpoints snap onto the link's text node). The
 * mark covers the link's rendered content in full, so its raw-markdown range
 * is the whole construct: `[project docs](…)`, not `project docs` (FR-011).
 */
function hoistTargetOutward(mark: MarkNode): LexicalNode | null {
  let node: LexicalNode = mark;
  let target: LexicalNode | null = null;

  for (let parent = node.getParent(); parent; parent = node.getParent()) {
    if ($isMarkNode(parent)) {
      node = parent;
      continue;
    }
    if (!isHoistableConstruct(parent) || !coversAllOf(node, parent)) break;
    target = parent;
    node = parent;
  }

  // The token is emitted as a sibling of `target`, so `target`'s own parent has
  // to be one whose inline run can carry it — and that parent has to route
  // `target` itself through that run rather than to the block dispatcher.
  return target && canCarryHoistedTokens(target.getParent()) && hoistedTokenReachesOutput(target) ? target : null;
}

/**
 * Whether a hoisted token emitted among `parent`'s inline children would
 * actually reach the output.
 *
 * A fenced code block's content is concatenated raw text (`convertCodeNode`),
 * and a link's own body has only text runs routed through the phrasing list —
 * its wiki-link form has nothing but the alias slot to write into. A token
 * emitted into either would simply be dropped, so those boundaries keep the
 * leaf splice.
 */
function canCarryHoistedTokens(parent: LexicalNode | null): boolean {
  let node = parent;
  while (node && $isMarkNode(node)) node = node.getParent();
  return !!node && $isElementNode(node) && !$isCodeNode(node) && !$isLinkNode(node);
}

/**
 * The same question asked of the *construct* rather than its container, because
 * one container routes its children unevenly.
 *
 * `convertListItemNode` sends only text runs, line breaks and links through the
 * inline phrasing path; every other child goes to the block dispatcher, which
 * has nowhere to put a phrasing token. Hoisting a boundary onto one of those
 * would drop the token silently, and `locateLiveMarkdownRange` would then fail
 * to find the mark at all.
 *
 * No document reaches that state today, which is why this is a guard rather
 * than a fix: an image, inline equation, footnote reference or inline HTML
 * inside a list item is *itself* block-promoted by that same dispatcher, so it
 * does not survive a round trip inline (`- The value $x^2$ matters` exports as
 * three blocks) and any range over it is already rejected by
 * `locateLiveMarkdownRange`'s slice check. Repairing that unrelated,
 * pre-existing round-trip defect must not silently regress annotation ranges as
 * its side effect.
 */
function hoistedTokenReachesOutput(node: LexicalNode): boolean {
  let parent = node.getParent();
  while (parent && $isMarkNode(parent)) parent = parent.getParent();
  return $isListItemNode(parent) ? $isLinkNode(node) : true;
}

/**
 * The node a mark's boundary token should be emitted outside of, or null to
 * keep today's splice into the boundary text leaf.
 *
 * The rule is structural: **hoist past every inline construct whose whole
 * rendered content the mark covers and whose emitted syntax abuts this
 * boundary.** Two shapes, checked in that order:
 *
 * 1. the mark sits *inside* one or more constructs and covers each one's
 *    content entirely — {@link hoistTargetOutward}; the outermost wins, so
 *    `[**rests**](url)` closes after the link rather than after the `**`;
 * 2. the boundary child is itself a construct (a link the mark contains) or a
 *    formatted text leaf whose maximal same-format run lies entirely inside the
 *    mark — hoist past that construct's shared delimiters.
 *
 * Otherwise the mark covers only *part* of the construct, its delimiter is
 * shared with text the mark doesn't cover, and the token stays where it is.
 *
 * That last case is deliberate, and is where this deviates from the spec's
 * FR-014, which would widen a partial-coverage mark out to the construct's
 * boundaries too. Widening there changes what the annotation *means*: a mark
 * over `big` inside `**big world**` would recover as `**big world**`, so
 * re-placing that anchor would highlight `big world` — a different span than
 * the user selected, which FR-017's existing corpus
 * (`annotation-marks.test.ts`'s `FORMATTING_CORPUS`) pins against. Whole
 * coverage has no such problem: re-placing `[project docs](…)` snaps back
 * inside the syntax and highlights `project docs` again. FR-014's first clause
 * holds either way — a boundary always sits at a text-leaf edge, never
 * strictly inside a delimiter run.
 */
function hoistTargetAt(mark: MarkNode, edge: 'start' | 'end'): LexicalNode | null {
  const outward = hoistTargetOutward(mark);
  if (outward) return outward;

  const context = markPhrasingContext(mark);
  if (!context) return null;
  const { flat, first, last } = context;

  // Skip line breaks the same way the leaf walk does, so a mark that opens or
  // closes on one still looks past it to the real boundary content.
  let index = edge === 'start' ? first : last;
  const step = edge === 'start' ? 1 : -1;
  while (index >= first && index <= last && $isLineBreakNode(flat[index])) index += step;
  if (index < first || index > last) return null;

  if (isHoistableConstruct(flat[index])) return hoistedTokenReachesOutput(flat[index]) ? flat[index] : null;

  const run = mergeableRunBounds(flat, index);
  if (run && run.start >= first && run.end <= last) return flat[edge === 'start' ? run.start : run.end];
  return null;
}

/**
 * Populates the four sentinel-placement maps for every live mark carrying `id`.
 *
 * Its own first rendered-text leaf gets an open-token prefix and its own last a
 * close-token suffix — *unless* that boundary abuts an inline construct the
 * mark wholly covers, in which case the token is hoisted out to the construct's
 * own boundary instead (see {@link hoistTargetAt}). Without the hoist, a mark
 * over `it [rests](https://example.com)` put its close token on the link's
 * *text* leaf, so the recovered range read `it [rests` — a slice ending inside
 * link syntax, which a host's refresh pass then wrote back as the annotation's
 * stored target (Liminis #970, defect 2).
 *
 * A multi-block/multi-mark annotation (several sibling MarkNodes sharing `id`)
 * gets one such pair per mark instance — deliberately, so the caller can
 * recover a per-mark boundary even when the marks aren't textually adjacent.
 */
function collectSentinelPlacements(id: string): void {
  const before = new Map<LexicalNode, string>();
  const after = new Map<LexicalNode, string>();
  const hoistBefore = new Map<LexicalNode, string>();
  const hoistAfter = new Map<LexicalNode, string>();

  for (const mark of collectMarksWithId(id)) {
    const kids = effectiveChildren(mark);

    const openAt = hoistTargetAt(mark, 'start');
    if (openAt) {
      hoistBefore.set(openAt, id);
    } else {
      const first = firstTextLeaf(kids);
      if (first) before.set(first, id);
    }

    const closeAt = hoistTargetAt(mark, 'end');
    if (closeAt) {
      hoistAfter.set(closeAt, id);
    } else {
      const last = lastTextLeaf(kids);
      if (last) after.set(last, id);
    }
  }

  sentinelBefore = before;
  sentinelAfter = after;
  hoistedBefore = hoistBefore;
  hoistedAfter = hoistAfter;
}

/**
 * The mdast text nodes carrying any hoisted tokens recorded for
 * `kids[start..end)` at `edge` — emitted as siblings immediately before (resp.
 * after) that slice's own converted output, which is what puts them outside the
 * construct's syntax. Empty whenever annotate mode is off.
 */
function hoistedTokenNodes(
  kids: readonly LexicalNode[],
  start: number,
  end: number,
  edge: 'before' | 'after',
): PhrasingContent[] {
  const map = edge === 'before' ? hoistedBefore : hoistedAfter;
  if (!map || map.size === 0) return [];
  const result: PhrasingContent[] = [];
  for (let i = start; i < end; i++) {
    const id = map.get(kids[i]);
    if (id) result.push({ type: 'text', value: edge === 'before' ? markOpenToken(id) : markCloseToken(id) });
  }
  return result;
}

/** {@link hoistedTokenNodes} for a single node. */
function hoistedTokenNodesFor(node: LexicalNode, edge: 'before' | 'after'): PhrasingContent[] {
  return hoistedTokenNodes([node], 0, 1, edge);
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

// Removes one leading space character from `value`, skipping past any
// complete leading sentinel token(s) first so annotate mode's boundary
// markers keep their position (Liminis #970's invariant: a decision made
// from a text value must be made against its sentinel-stripped form, and any
// mutation must not perturb where the tokens land).
function stripLeadingSpaceKeepingSentinels(value: string): string {
  let i = 0;
  while (i < value.length) {
    if (value[i] === SENTINEL_OPEN_START) {
      const endIdx = value.indexOf(SENTINEL_OPEN_END, i + 1);
      if (endIdx === -1) break;
      i = endIdx + 1;
      continue;
    }
    if (value[i] === SENTINEL_CLOSE_START) {
      const endIdx = value.indexOf(SENTINEL_CLOSE_END, i + 1);
      if (endIdx === -1) break;
      i = endIdx + 1;
      continue;
    }
    break;
  }
  if (value[i] === ' ') {
    return value.slice(0, i) + value.slice(i + 1);
  }
  return value;
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
  const rest: LexicalNode[] = labelIndex === -1 ? [] : siblings.slice(labelIndex + 1);

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
    // A footnote definition's own inline children bypass
    // convertInlinePhrasingList for everything but text runs, so any token
    // hoisted outside one of these constructs has to be emitted here too.
    contentChildren.push(...hoistedTokenNodesFor(child, 'before'));
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
    contentChildren.push(...hoistedTokenNodesFor(child, 'after'));
    restIndex++;
    child = rest[restIndex] ?? null;
  }
  flushTextRun();

  // The label is followed on import by a synthetic single-space separator
  // TextNode. If the definition body starts with plain text, Lexical's
  // reconciliation merges that separator into the body's own TextNode
  // (' ' + 'The body.' -> ' The body.') rather than leaving it as a
  // distinct sibling, so it can't be skipped above by identity. Strip
  // exactly one leading space from the first text child here instead, which
  // handles both the merged and unmerged cases identically. The decision is
  // made against the sentinel-stripped form (annotate mode may have spliced
  // boundary tokens into this same node) and the removal keeps those tokens
  // in place — see `stripLeadingSpaceKeepingSentinels`.
  const first = contentChildren[0];
  if (first?.type === 'text' && stripAnnotateSentinels(first.value).startsWith(' ')) {
    const value = stripLeadingSpaceKeepingSentinels(first.value);
    // Keep the node even if stripping the space left no real text — it may
    // still carry sentinel tokens that must not be dropped (Liminis #970).
    // Only an entirely empty string means there's nothing left to emit.
    if (value.length > 0) {
      contentChildren[0] = { ...first, value };
    } else {
      contentChildren.shift();
    }
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

/**
 * True for children that must be dispatched as their own block, rather than
 * folded into the surrounding inline run. Deliberately excludes
 * Image/Equation/Footnote/Html — those stay inline-eligible and are handled by
 * `convertInlinePhrasingList` (see `isInlineDelimitedNode`-adjacent dispatch).
 */
function isQuoteBlockChild(node: LexicalNode): boolean {
  return (
    $isParagraphNode(node) ||
    $isHeadingNode(node) ||
    $isListNode(node) ||
    $isFrontmatterNode(node) ||
    $isCodeNode(node) ||
    $isHorizontalRuleNode(node) ||
    $isTableNode(node) ||
    $isCalloutNode(node) ||
    $isToggleContainerNode(node) ||
    $isMermaidNode(node) ||
    $isC4Node(node) ||
    $isDefinitionListNode(node) ||
    $isQuoteNode(node)
  );
}

/**
 * QuoteNode is reachable via two structurally different shapes: markdown
 * import (`convertBlockquote` in mdastToLexical.ts gives it real ParagraphNode
 * — and other block-node — children, one per mdast paragraph, so consecutive
 * paragraphs survive as separate blocks) and live typing (Lexical's own
 * `registerRichText` never wraps typed content in a ParagraphNode, so a
 * live-typed quote's children are flat TextNode/LineBreakNode runs). This
 * buffer-and-flush loop handles both: block-type children (paragraphs and
 * other block content) are dispatched individually through the shared block
 * dispatcher, while everything else is buffered and flushed through the same
 * `convertInlinePhrasingList` call `convertInlineChildren` uses elsewhere, so
 * Image/Equation/Footnote/Html/mark-transparency handling stays exactly as it
 * is for a flat, non-block quote. See #18.
 */
function convertQuoteNode(node: ElementNode): Blockquote {
  const { nodes, marked } = effectiveChildrenWithMarkMembership(node);

  const children: Content[] = [];
  let buffer: LexicalNode[] = [];

  const flushBuffer = (): void => {
    if (buffer.length > 0) {
      const paragraph: Paragraph = {
        type: 'paragraph',
        children: convertInlinePhrasingList(buffer, marked) as PhrasingContent[],
      };
      children.push(paragraph);
      buffer = [];
    }
  };

  for (const child of nodes) {
    if (isQuoteBlockChild(child)) {
      flushBuffer();
      children.push(...convertLexicalNode(child));
    } else {
      buffer.push(child);
    }
  }
  flushBuffer();

  if (children.length === 0) {
    children.push({ type: 'paragraph', children: [{ type: 'text', value: '' }] });
  }

  return {
    type: 'blockquote',
    children: children as Blockquote['children'],
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
      // A list item's own inline children bypass convertInlinePhrasingList for
      // everything but text runs, so any token hoisted outside this link has to
      // be emitted here too.
      inlineChildren.push(
        ...hoistedTokenNodesFor(child, 'before'),
        convertLinkNode(child),
        ...hoistedTokenNodesFor(child, 'after'),
      );
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
  //
  // The test runs against the sentinel-*free* text: in annotate mode the
  // paragraph's first value is prefixed with an open token, so matching the raw
  // value made this decision flip to false and the item got a `checked` flag on
  // top of the literal marker it already carried — `1. [ ] [ ] Run the setup
  // script`, i.e. annotate mode changing output outside its own tokens, which
  // is exactly what `locateLiveMarkdownRange`'s offset math forbids (#970).
  let hasExplicitMarker = false;
  const firstChild = children[0];
  if (firstChild?.type === 'paragraph') {
    const firstPhrasing = firstChild.children[0];
    if (firstPhrasing?.type === 'text' && /^\[( |x|X)\]\s+/.exec(stripAnnotateSentinels(firstPhrasing.value))) {
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
// (a node type with no format bitmask, like images/breaks).
//
// Code formatting is deliberately *not* a disqualifier (#973): a code-formatted
// TextNode that also carries bold/italic/strikethrough belongs inside that
// wrapper, as an `inlineCode` node. A code-formatted node carrying no other bit
// yields 0, which still fails the `if (format)` guard at every call site, so
// pure-inline-code behaviour is unchanged.
function getMergeableFormat(child: LexicalNode): number | null {
  if ($isTextNode(child)) {
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

// Flattens a list of leaf-level inline nodes into mdast content with no
// format wrapping — the base case once every bold/italic/strikethrough bit
// a run carries has been consumed by an enclosing wrapper.
//
// Consecutive code-formatted members accumulate and flush as a single
// `inlineCode` node (#973), mirroring convertCodeRun: a mark splitting a
// code span leaves adjacent code-format siblings, and mdast-util-to-markdown
// never merges adjacent inlineCode nodes back together.
function convertLeavesRaw(nodes: LexicalNode[]): PhrasingContent[] {
  const content: PhrasingContent[] = [];

  let codeBuffer = '';
  const flushCode = (): void => {
    if (codeBuffer === '') return;
    content.push({ type: 'inlineCode', value: codeBuffer });
    codeBuffer = '';
  };

  for (const node of nodes) {
    if ($isTextNode(node)) {
      const text = sentinelAugmentedText(node);
      if (text === '') {
        continue;
      }
      if (node.hasFormat('code')) {
        codeBuffer += text;
        continue;
      }
      flushCode();
      // An escaped character imported inside emphasis/strong (e.g.
      // `*text \_x\_*`) takes this merged-run export path even on a pure
      // no-edit round trip, so the force-escape hint must be read here too,
      // not just in convertTextNode's single-node path (#17). Gated by
      // isForceEscapableContent so a stale hint on a since-edited node can't
      // wrap unrelated typed content in a spurious backslash.
      const forceEscape = getForceEscapeFlag(node.getStyle() || '') && isForceEscapableContent(node.getTextContent());
      content.push({ type: 'text', value: text, data: forceEscape ? { _forceEscape: true } : undefined } as PhrasingContent);
    } else if ($isEquationNode(node)) {
      flushCode();
      content.push({ type: 'inlineMath', value: node.getEquation() });
    } else if ($isFootnoteNode(node)) {
      flushCode();
      content.push({
        type: 'footnoteReference',
        identifier: node.getFootnoteId(),
        label: node.getFootnoteId(),
      } as unknown as PhrasingContent);
    }
  }
  flushCode();

  return content;
}

// Scans `nodes` for the strong/emphasis marker style hints (`--md-strong-marker`
// / `--md-emphasis-marker`) carried on text nodes, or the equivalent getters on
// equation/footnote nodes — the first non-empty hint for each wins.
//
// Marker hints are read regardless of a text node's own code formatting, so a
// run whose only styled member is code-formatted still keeps its `_`/`*`
// rather than normalizing. Empty text nodes are skipped: Lexical creates
// empty format-carrying TextNodes as caret placeholders when a format is
// toggled before anything is typed, and one of those carrying a stale marker
// style must not decide the whole run's marker.
function resolveMarkers(nodes: LexicalNode[]): { strongMarker: '_' | '*' | null; emphasisMarker: '_' | '*' | null } {
  let strongMarker: '_' | '*' | null = null;
  let emphasisMarker: '_' | '*' | null = null;

  for (const node of nodes) {
    if ($isTextNode(node)) {
      const text = sentinelAugmentedText(node);
      if (text === '') continue;
      const style = node.getStyle() || '';
      strongMarker = strongMarker ?? getMarkdownMarker(style, '--md-strong-marker');
      emphasisMarker = emphasisMarker ?? getMarkdownMarker(style, '--md-emphasis-marker');
    } else if ($isEquationNode(node) || $isFootnoteNode(node)) {
      strongMarker = strongMarker ?? node.getStrongMarker();
      emphasisMarker = emphasisMarker ?? node.getEmphasisMarker();
    }
  }

  return { strongMarker, emphasisMarker };
}

// Builds nested strong/emphasis/delete wrappers from a run of siblings whose
// bold/italic/strikethrough bits may *differ* but overlap — the shape
// produced when importing e.g. `**bold and _nested italic_ inside**`, where
// the enclosing bold survives as a shared bit across three siblings while
// only the middle one also carries italic (see `convertInlineUnit`, which
// selects the run this is called on).
//
// Recursively: group the run into maximal sub-runs whose formats share a
// common non-zero bit (the running AND across the sub-run never drops to
// zero), wrap each sub-run in that common format, and recurse on each
// member's *residual* bits (its own format minus the common bits) to build
// the nested content — bottoming out once a member's residual format is 0,
// at which point it's flattened via `convertLeavesRaw`. For a uniform run
// (every member's format literally equal, the classic case), this collapses
// to a single group spanning the whole run with zero residual everywhere,
// reproducing the old single-wrapper behavior exactly.
function buildFormattedContent(members: { node: LexicalNode; format: number }[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  let i = 0;
  while (i < members.length) {
    if (members[i].format === 0) {
      let j = i + 1;
      while (j < members.length && members[j].format === 0) j++;
      result.push(...convertLeavesRaw(members.slice(i, j).map((m) => m.node)));
      i = j;
      continue;
    }

    let common = members[i].format;
    let j = i + 1;
    while (j < members.length && (members[j].format & common) !== 0) {
      common &= members[j].format;
      j++;
    }

    const group = members.slice(i, j);
    const residual = group.map((m) => ({ node: m.node, format: m.format & ~common }));
    const inner = buildFormattedContent(residual);
    const { strongMarker, emphasisMarker } = resolveMarkers(group.map((m) => m.node));
    result.push(wrapWithFormat(inner, common, strongMarker, emphasisMarker));
    i = j;
  }

  return result;
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
 *
 * Conversion proceeds in *units*: a merged run, or a single child. Any
 * annotate-mode token hoisted out of a construct within a unit is emitted as
 * its own sibling text node immediately before/after that unit's output, which
 * is precisely what puts it outside the unit's delimiters (see
 * `collectSentinelPlacements`). Off annotate mode the token lists are always
 * empty and this is the same conversion as before.
 */
function convertInlinePhrasingList(
  kids: readonly LexicalNode[],
  marked: ReadonlySet<LexicalNode>,
): PhrasingContentLike[] {
  const children: PhrasingContentLike[] = [];

  let i = 0;
  while (i < kids.length) {
    const { content, next } = convertInlineUnit(kids, marked, i);
    children.push(...hoistedTokenNodes(kids, i, next, 'before'));
    children.push(...content);
    children.push(...hoistedTokenNodes(kids, i, next, 'after'));
    i = next;
  }

  return children;
}

/**
 * One emission unit of {@link convertInlinePhrasingList}, starting at `i`:
 * its converted content and the index the next unit starts at.
 */
function convertInlineUnit(
  kids: readonly LexicalNode[],
  marked: ReadonlySet<LexicalNode>,
  i: number,
): { content: PhrasingContentLike[]; next: number } {
  const child = kids[i];

  // A mark splitting an inline-code span leaves adjacent code-format text
  // siblings, and mdast-util-to-markdown never merges adjacent inlineCode
  // nodes back together (each gets its own backtick pair) — so the run has to
  // be concatenated before conversion.
  //
  // Only *pure* inline code takes this path: a code-formatted node that also
  // carries a bold/italic/strikethrough bit must stay available to the
  // formatted-run path below, which nests it inside its wrapper (#973).
  if ($isTextNode(child) && child.hasFormat('code') && !getMergeableFormat(child)) {
    let j = i + 1;
    let runTouchesMark = marked.has(child);
    while (
      j < kids.length &&
      $isTextNode(kids[j]) &&
      (kids[j] as TextNode).hasFormat('code') &&
      !getMergeableFormat(kids[j])
    ) {
      if (marked.has(kids[j])) runTouchesMark = true;
      j++;
    }
    if (runTouchesMark && j > i + 1) {
      return { content: convertCodeRun(kids.slice(i, j) as TextNode[]), next: j };
    }
  }

  const format = getMergeableFormat(child);

  if (format) {
    // Find the maximal run of consecutive siblings whose formats keep a
    // non-empty running intersection (`common`) — a strict generalization of
    // "sharing this exact format": a uniform run (every member's format
    // literally equal) is the special case where the intersection never
    // actually shrinks, but a run like bold/bold+italic/bold (produced by
    // `**bold and _nested italic_**`) also qualifies, with `common` settling
    // on the shared bold bit. `uniform` tracks whether the run was exact-match
    // throughout, so the merge condition below can keep today's narrow gates
    // for that case while unconditionally merging the newly-reachable
    // non-uniform (genuinely nested) case — see `buildFormattedContent`,
    // which recovers the nested wrapper structure from each member's residual
    // (non-common) bits.
    const isCodeMember = (node: LexicalNode): boolean => $isTextNode(node) && node.hasFormat('code');
    let j = i + 1;
    let common = format;
    let uniform = true;
    let hasNonTextMember = !$isTextNode(child);
    let hasCodeMember = isCodeMember(child);
    let runTouchesMark = marked.has(child);
    while (j < kids.length) {
      const nextFormat = getMergeableFormat(kids[j]);
      if (nextFormat === null || (nextFormat & common) === 0) break;
      if (nextFormat !== format) uniform = false;
      common &= nextFormat;
      if (!$isTextNode(kids[j])) {
        hasNonTextMember = true;
      }
      if (isCodeMember(kids[j])) hasCodeMember = true;
      if (marked.has(kids[j])) runTouchesMark = true;
      j++;
    }

    // The `hasCodeMember` disjunct is Liminis-specific and has no counterpart in
    // Zusammen's reference fix, whose gate merges any multi-member run
    // unconditionally. Liminis narrowed the gate to `runTouchesMark` (#970/#977)
    // so mark-free documents keep byte-identical output — but that narrowing
    // would send a mark-free `**`code` more text**` down the per-node path,
    // emitting two adjacent `strong` nodes that mdast-util-to-markdown will not
    // join (`**`code`**** more text**`). Do not "simplify" this away.
    //
    // Safe under FR-009: a multi-member uniform run containing a code member
    // could not form before this issue, because getMergeableFormat returned
    // null for code nodes and terminated the scan.
    //
    // `!uniform` merges unconditionally (#16): the differing-but-overlapping
    // run shape it covers was never reachable before this fix (the old scan
    // always stopped at the first unequal sibling), so no existing fixture can
    // depend on the old (broken) un-merged behavior for it.
    if (hasNonTextMember || (hasCodeMember && j > i + 1) || (runTouchesMark && j > i + 1) || !uniform) {
      const members = kids.slice(i, j).map((node) => ({ node, format: getMergeableFormat(node) ?? 0 }));
      return { content: buildFormattedContent(members), next: j };
    }
  }

  return { content: convertSingleInlineChild(child), next: i + 1 };
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
  // Gated by isForceEscapableContent so a stale hint on a since-edited node
  // can't wrap unrelated typed content in a spurious backslash (#17).
  const forceEscape = getForceEscapeFlag(style) && isForceEscapableContent(node.getTextContent());

  if (text === '') {
    return [];
  }

  // The base node is chosen first, then wrapped — a code-formatted node that
  // also carries bold/italic/strikethrough keeps that wrapper (#973), where
  // previously a trailing `format & 16` short-circuit discarded it.
  // `_forceEscape` only applies to the plain-text base (#17): code content is
  // emitted verbatim and never escaped, so the hint is meaningless there.
  let result: PhrasingContent =
    format & 16
      ? { type: 'inlineCode', value: text }
      : { type: 'text', value: text, data: forceEscape ? { _forceEscape: true } : undefined } as PhrasingContent;

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
  const linkNode = node as unknown as {
    getURL: () => string;
    getTitle: () => string | null;
    getWikiLinkOrigin?: () => boolean;
  };
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
  // `wikiLinkPromotionMode` (liminis#951) additionally lets a host opt out of
  // promoting an *ordinary* link whose URL merely looks wiki-link-shaped. It
  // never suppresses a link that was genuine wiki-link syntax on import
  // (`getWikiLinkOrigin()`) — an opted-out host must not corrupt a document's
  // existing `[[...]]` links, only stop creating new ones.
  const isGenuineWikiLink = linkNode.getWikiLinkOrigin?.() ?? false;
  if ((wikiLinkPromotionMode === 'promote' || isGenuineWikiLink) && isWikiLinkUrl(url) && !linkNode.getTitle()) {
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

    // Annotate mode (`setAnnotateTarget`) brackets a live mark's own text with
    // sentinel tokens so `locateLiveMarkdownRange` can recover the mark's real
    // raw-markdown range. `getTextContent()` above flattens through MarkNode
    // but never calls `sentinelAugmentedText`, so an annotation anchored inside
    // a wiki-link's alias emitted no tokens at all — capture then found none
    // and silently declined (review finding, @handarbeit-pruefer). Note this
    // reaches further than hand-written `[[…|…]]`: a plain `[text](page.md)`
    // link is promoted to wiki-link syntax by the branch above, so it was
    // affected too.
    //
    // The alias is the only slot in wiki-link syntax that can carry the
    // tokens, so they go there — but every *decision* below (alias-or-not,
    // representative format) still reads the sentinel-free `displayText`. That
    // matters: annotate mode must not turn a `[[page]]` into a `[[page|…]]`,
    // because `locateLiveMarkdownRange`'s offset math requires everything
    // outside the bracketed span to stay byte-identical to a plain export.
    //
    // Concatenating the flattened children must reproduce `displayText`
    // exactly before the augmented form is trusted; otherwise we emit the
    // plain text, the same "decline rather than mis-place" trade the rest of
    // this pathway makes.
    //
    // Known gap: a wiki-link with no alias (`[[the quick brown fox]]`) has
    // nowhere to put the tokens without inventing an alias, which would be
    // exactly the structural change ruled out above. An annotation anchored
    // there still declines to capture.
    let aliasText = displayText;
    if (linkChildren.map((child) => child.getTextContent()).join('') === displayText) {
      const augmented = linkChildren
        .map((child) => ($isTextNode(child) ? sentinelAugmentedText(child) : child.getTextContent()))
        .join('');
      if (augmented !== displayText) aliasText = augmented;
    }

    let textFormat = 0;

    // Use the format of the first TextNode child as the representative format.
    // Reuses the mark-flattened `linkChildren` from the top of this function
    // (`effectiveChildrenWithMarkMembership`'s `nodes` is exactly
    // `effectiveChildren`), so an annotation over the link's text doesn't hide
    // the representative TextNode behind a MarkNode wrapper.
    if (linkChildren.length > 0 && $isTextNode(linkChildren[0])) {
      textFormat = linkChildren[0].getFormat();
    }

    const hasAlias = displayText && displayText !== target;
    const aliasState = (node as any).getWikiAliasState?.() ?? null;

    const data: any = {};
    if (hasAlias) {
      // Format the alias with markers if the text has formatting
      data.alias = formatAliasWithMarkers(aliasText, textFormat);
    } else if (textFormat !== 0 && displayText) {
      // No alias (displayText === target) but text is formatted
      // We need to create an alias to preserve the formatting
      data.alias = formatAliasWithMarkers(aliasText, textFormat);
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

// Reads the `--md-force-escape` style hint set by `setForceEscape` in
// `mdastToLexical.ts` (#17) — marks a single-character TextNode whose source
// backslash escape must be restored verbatim at stringify time.
function getForceEscapeFlag(style: string): boolean {
  return /--md-force-escape\s*:\s*1/.test(style);
}

// The same seven-character set `splitTextNodeEscapes` (`parse.ts`) tags at
// import time. Mirrored here (rather than imported) because parse-time and
// export-time concerns are otherwise kept independent in this codebase.
const FORCE_ESCAPE_CHARS = new Set(['*', '_', '`', '[', ']', '#', '\\']);

// Guards against a stale `--md-force-escape` style hint corrupting freshly
// typed content (#17). The style hint is set on a TextNode that, at import
// time, is guaranteed to hold exactly one force-escaped character — but
// Lexical's own reconciliation can extend that same TextNode's text (and
// keep its style) when the user types adjacent to it during live editing,
// which would otherwise carry the hint onto arbitrary new characters and
// wrap them in a spurious, meaning-changing backslash at stringify time
// (e.g. typing "a" next to an escaped "_" must never emit "\a"). Requiring
// every character of the node's live text content to itself be one of the
// seven force-escapable characters keeps the hint's effect scoped to
// content it can actually still describe; anything else safely falls back
// to ordinary (unescaped) text, at worst re-losing the original escape
// rather than corrupting adjacent content.
function isForceEscapableContent(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => FORCE_ESCAPE_CHARS.has(ch));
}

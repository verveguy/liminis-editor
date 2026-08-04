/**
 * PROVENANCE — ported from Zusammen (`verveguy/zusammen`) for Liminis #939.
 *
 * The doc comments below are the original author's and are kept verbatim so
 * this module stays diffable against its source. Their `FR-NNN`/`SC-NNN`
 * identifiers, `#NN` issue references and `adrs/` paths therefore name
 * **Zusammen's** spec, issues and ADRs — not this repository's, where the same
 * identifiers mean something else entirely. For the Liminis-side design see
 * `docs/project_notes/decisions/adr-076.md` and
 * `docs/project_notes/zusammen-editor-capability-map.md`.
 *
 * "Comment"/"thread" in these comments should be read as "annotation": this
 * module now serves both annotation kinds, not comments alone.
 */
/**
 * Comment Anchor Marks (#43)
 *
 * Replaces `comment-anchor-mapping.ts`'s ordinal-block-index glue with a live
 * `@lexical/mark` `MarkNode` per annotation id — the anchor moves with
 * its text across in-app edits for free (Lexical splits/merges nodes around
 * it), and serializes to nothing (see `lexicalToMdast.ts`'s
 * `effectiveChildren`), so it never touches document content (ADR-003).
 *
 * Two directions, both content-based rather than block-ordinal-based:
 *
 * - **Write** (capture, FR-006 re-anchor): a mark's own live plain text is
 *   *not* generally a verbatim substring of the document's current raw
 *   markdown — once the target contains or abuts bold/italic/inline-code/
 *   link syntax, the rendered text and the markdown diverge (#47 fixes the
 *   defect this caused: comments on formatted text spuriously flagging as
 *   changed on a completely unchanged document; see the corrected premise
 *   noted in `adrs/012-comment-anchor-as-live-mark.md`). Instead, a mark's
 *   raw-markdown range is recovered via {@link locateLiveMarkdownRange}'s
 *   annotated-serialize mechanism. A multi-block annotation shares one id
 *   across several sibling `MarkNode`s (the Lexical playground's own
 *   pattern); each is independently located, and the comment's overall
 *   range is the span from the first mark's start to the last mark's end —
 *   recovering exactly what
 *   {@link import('../../../shared/anchor-model').captureAnchor} would slice
 *   for a single-block annotation, and the same *kind* of raw-markdown slice
 *   (including whatever lies between the marks) for a multi-block one.
 * - **Read** (load-time placement): an anchor's `targetText` is already the
 *   resolver's exact/resolved current text (main-process
 *   `resolveAnchorsForDocument` runs before marker targets ever reach the
 *   editor) — locate it once in the raw markdown via `locateInSpan`, map
 *   that offset range onto Lexical nodes via the parse-time `OffsetSpan[]`
 *   (boundary-snapping past any formatting-delimiter gap the target's edge
 *   falls on, #47), and wrap. No client-side fuzzy matching.
 */
import {
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $isMarkNode, $unwrapMarkNode, $wrapSelectionInMarkNode, MarkNode } from '@lexical/mark';
import { captureAnchor, type Anchor, type AnchorFields, type AnchorRange } from '../../annotations/anchor-model';
import { locateInSpan } from '../../annotations/anchor-align';
import type { OffsetSpan } from '../mapper/mdastToLexical';
import { exportLexicalToMdastInEditorState, markCloseToken, markOpenToken, setAnnotateTarget } from '../mapper/lexicalToMdast';
import { stringifyMarkdown } from '../../markdown/stringify';

/** Depth-first, document-order walk collecting every `MarkNode` in the tree. */
function collectMarkNodesInOrder(root: ElementNode): MarkNode[] {
  const result: MarkNode[] = [];
  const visit = (node: LexicalNode): void => {
    if ($isMarkNode(node)) result.push(node);
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  visit(root);
  return result;
}

/** Document-order live plain text of every `MarkNode` currently wrapping `id`. */
function liveMarkTexts(id: string): string[] {
  return collectMarkNodesInOrder($getRoot())
    .filter((node) => node.hasID(id))
    .map((node) => node.getTextContent());
}

/**
 * Runs the annotated-serialize export for `id` (see `lexicalToMdast.ts`'s
 * `setAnnotateTarget`) and discards everything except the resulting string —
 * a throwaway mechanism purely for locating `id`'s live mark(s) in the
 * markdown domain (#47). Must run inside an active `editor.update()`/
 * `editor.getEditorState().read()`.
 */
function exportAnnotatedMarkdown(id: string): string {
  setAnnotateTarget(id);
  try {
    return stringifyMarkdown(exportLexicalToMdastInEditorState());
  } finally {
    setAnnotateTarget(null);
  }
}

/**
 * Locates an annotation's overall raw-markdown range from its live mark(s) —
 * the write pathway, and the fix for #47: rather than searching for a mark's
 * *rendered* plain text inside `markdownText` (unreliable once the target
 * contains or abuts formatting — "quick" is not a substring of
 * "**quick**...brown" once the closing delimiter falls inside the target),
 * this brackets the mark's own content with sentinel tokens via an annotated
 * serialize, then finds those tokens in the result. Annotate mode changes
 * nothing else, so everything outside the sentinel-bracketed span is
 * byte-identical to `markdownText` — meaning the first open token's own
 * position in the annotated string *is* the mark's real start offset in
 * `markdownText`, and the (sentinel-stripped) text between the outermost
 * tokens *is* the exact raw-markdown slice the mark covers.
 *
 * A multi-block/multi-mark annotation (several sibling MarkNodes sharing `id`,
 * e.g. spanning a heading and the paragraph after it) produces one
 * open/close pair per mark instance; the range spans the earliest open to
 * the latest close, with any of the *other* instances' own tokens landing
 * inside that span stripped back out of the slice — recovering exactly what
 * {@link captureAnchor} would slice for the equivalent single range,
 * including whatever real markdown lies between the marks.
 *
 * Returns null if the annotation has no live mark, (defensively — should not
 * happen for a live mark) its sentinel tokens can't be found, or (review
 * finding, #47) `markdownText` turns out not to actually match the derived
 * range — see the check below.
 */
function locateLiveMarkdownRange(markdownText: string, id: string): AnchorRange | null {
  if (collectMarkNodesInOrder($getRoot()).filter((node) => node.hasID(id)).length === 0) return null;

  const annotated = exportAnnotatedMarkdown(id);
  const openToken = markOpenToken(id);
  const closeToken = markCloseToken(id);

  const firstOpen = annotated.indexOf(openToken);
  const lastClose = annotated.lastIndexOf(closeToken);
  if (firstOpen === -1 || lastClose === -1 || lastClose < firstOpen) return null;

  const start = firstOpen;
  const rawSlice = annotated
    .slice(firstOpen + openToken.length, lastClose)
    .split(openToken)
    .join('')
    .split(closeToken)
    .join('');
  const end = start + rawSlice.length;

  // The offset math above is only valid because annotate mode changes
  // nothing else, so everything outside the sentinel-bracketed span is
  // byte-identical to a *plain* export of this same live state — true by
  // construction for every current caller (each derives `markdownText`
  // fresh from the same read, or from a ref kept in sync with it), but not
  // enforced by this function's own signature. If a caller ever passed a
  // `markdownText` that had drifted from the live tree, `start`/`end` would
  // silently point at the wrong substring rather than failing — verify
  // before trusting them.
  if (markdownText.slice(start, end) !== rawSlice) return null;
  return { start, end };
}

/** First text node in `node`'s subtree in document order (or `node` itself if it is one). */
function firstTextDescendant(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const text = firstTextDescendant(child);
    if (text) return text;
  }
  return null;
}

/** Last text node in `node`'s subtree in document order (or `node` itself if it is one). */
function lastTextDescendant(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (let child = node.lastChild; child; child = child.previousSibling) {
    const text = lastTextDescendant(child);
    if (text) return text;
  }
  return null;
}

/**
 * Resolve one endpoint of a native DOM `Range` to a Lexical text point.
 *
 * A native Range boundary is `(container, offset)` where `offset` means a
 * *character* index only when `container` is a text node. For selections that
 * land on element boundaries — word double-clicks, drag-to-block-edge, a
 * caret just before/after an inline span — Chromium reports `container` as the
 * *element* and `offset` as a *child index*. The old code fed that child index
 * straight in as a character offset, which is what silently truncated targets
 * to fragments ("agentic platform product" → "platform product") and let a
 * selection graze one character into the next block. Here we first normalize an
 * element boundary down to a concrete text node — the start of the child it
 * points before (`atEnd=false`) or the end of the child it points after
 * (`atEnd=true`) — so `offset` is always a real character offset into a single
 * rendered `TextNode`, then map that node to Lexical.
 */
function resolveRangeEndpoint(container: Node, offset: number, atEnd: boolean): { node: LexicalNode; offset: number } | null {
  let domNode: Node = container;
  let domOffset = offset;

  if (domNode.nodeType === Node.ELEMENT_NODE) {
    const children = domNode.childNodes;
    if (children.length === 0) return null;
    if (domOffset >= children.length) {
      const text = lastTextDescendant(children[children.length - 1]);
      if (!text) return null;
      domNode = text;
      domOffset = text.textContent?.length ?? 0;
    } else if (atEnd && domOffset > 0) {
      // A boundary *after* child N-1 (end point): land at the end of that child.
      const text = lastTextDescendant(children[domOffset - 1]);
      if (!text) return null;
      domNode = text;
      domOffset = text.textContent?.length ?? 0;
    } else {
      // A boundary *before* child N (start point): land at the start of it.
      const text = firstTextDescendant(children[domOffset]);
      if (!text) return null;
      domNode = text;
      domOffset = 0;
    }
  }

  if (domNode.nodeType !== Node.TEXT_NODE) return null;
  const lexNode = $getNearestNodeFromDOMNode(domNode);
  if (!$isTextNode(lexNode)) return null;
  return { node: lexNode, offset: Math.min(domOffset, lexNode.getTextContentSize()) };
}

/**
 * Push a selection's endpoints inward past any leading/trailing whitespace, so
 * a drag that grazes the space before the next block (or after the previous
 * one) never records a target whose enclosing block is ambiguous — the exact
 * cause of a "…Protocol " capture resolving as "crossed a structural boundary"
 * and flagging on reload. Only trims within the boundary text nodes themselves
 * (whitespace at a selection's very edge always lives there); a no-op for a
 * target that is already tight or is pure whitespace.
 */
function trimSelectionWhitespace(selection: ReturnType<typeof $createRangeSelection>): void {
  const text = selection.getTextContent();
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  if (leading + trailing >= text.length) return; // all whitespace — leave as-is

  // Resolve the document-order start/end from the selection's direction rather
  // than assuming anchor==start: our caller always builds a forward selection,
  // but keying the trim off `isBackward()` keeps this correct if it is ever
  // reused for a backward one (pushing the wrong endpoint would corrupt it).
  const isBackward = selection.isBackward();
  const startPoint = isBackward ? selection.focus : selection.anchor;
  const endPoint = isBackward ? selection.anchor : selection.focus;
  const startNode = startPoint.getNode();
  const endNode = endPoint.getNode();
  if (leading > 0 && $isTextNode(startNode) && startPoint.offset + leading <= startNode.getTextContentSize()) {
    startPoint.set(startPoint.key, startPoint.offset + leading, 'text');
  }
  if (trailing > 0 && $isTextNode(endNode) && endPoint.offset - trailing >= 0) {
    endPoint.set(endPoint.key, endPoint.offset - trailing, 'text');
  }
}

/**
 * Wrap a native DOM Range in a `MarkNode` keyed by `id`. Fire-and-forget: the
 * Lexical update runs the wrap, but its commit isn't observable synchronously
 * (in controlled mode the callback runs on a later tick), so callers must NOT
 * gate anything on a return value here — the anchor is read back from the live
 * mark later via {@link readAnchorFields}.
 */
export function wrapNativeRangeInMark(editor: LexicalEditor, range: Range, id: string): void {
  editor.update(
    () => {
      // A native Range (unlike a Selection) is always given in document
      // order — start never comes after end — so start→anchor / end→focus
      // map directly with no backward case to handle.
      const start = resolveRangeEndpoint(range.startContainer, range.startOffset, false);
      const end = resolveRangeEndpoint(range.endContainer, range.endOffset, true);
      if (!start || !end) return;

      const selection = $createRangeSelection();
      selection.anchor.set(start.node.getKey(), start.offset, 'text');
      selection.focus.set(end.node.getKey(), end.offset, 'text');
      trimSelectionWhitespace(selection);
      if (selection.getTextContent().length === 0) return; // nothing real selected
      $setSelection(selection);

      $wrapSelectionInMarkNode(selection, false, id);
    },
    { discrete: true },
  );
}

/**
 * Read an annotation's anchor fields directly from its live `MarkNode`(s) in the
 * Lexical tree — targetText, surrounding context, block type, and an
 * occurrence hint. The mark *is* the anchor; its position is known precisely
 * from the node structure, so capture never depends on a (possibly stale)
 * serialized-markdown string held elsewhere (`currentContentRef`) — this
 * function derives its own current markdown export fresh, every call. The
 * store stamps `docVersion`; the resolver (#25) still re-locates by content
 * on future document versions.
 *
 * #47: targetText (and the context/blockType/occurrenceIndex derived from
 * it) is a raw-*markdown* slice, not the mark's rendered plain text — see
 * {@link locateLiveMarkdownRange}. Once the mark's exact raw-markdown range
 * is known, {@link captureAnchor} (already markdown-domain-correct, and
 * already used by the FR-006 re-anchor path) does the rest.
 */
export function readAnchorFields(editor: LexicalEditor, id: string): AnchorFields | null {
  return editor.getEditorState().read(() => {
    if (collectMarkNodesInOrder($getRoot()).filter((n) => n.hasID(id)).length === 0) return null;

    const markdownText = stringifyMarkdown(exportLexicalToMdastInEditorState());
    const range = locateLiveMarkdownRange(markdownText, id);
    if (!range) return null;

    const { docVersion: _docVersion, ...fields } = captureAnchor(markdownText, range, 'live');
    return fields;
  });
}

/**
 * Read pathway: places a `MarkNode` for `anchor` by locating its (already
 * resolved/current) `targetText` in `markdownText` and mapping the located
 * offset range onto Lexical nodes via `offsetSpans` (the parse-time
 * offset->node table from `importMarkdownToLexicalWithOffsets`). Idempotent:
 * a no-op if `id` already has a live mark. Returns whether a mark now
 * exists for `id` (already present, or just placed) — false only when the
 * anchor's target can't be located or mapped, in which case the comment
 * stays panel-only (FR-008), never placed on unrelated text.
 */
export function placeMarkForAnchor(editor: LexicalEditor, offsetSpans: readonly OffsetSpan[], markdownText: string, anchor: Anchor, id: string): boolean {
  let placed = false;
  editor.update(
    () => {
      placed = $placeMarkForAnchor(offsetSpans, markdownText, anchor, id);
    },
    { discrete: true },
  );
  return placed;
}

/**
 * Places many anchors inside a *single* `editor.update()`.
 *
 * Same per-anchor logic as {@link placeMarkForAnchor}, but one Lexical
 * reconciliation for the whole batch instead of one per annotation — a
 * document with dozens of live annotations otherwise pays a synchronous
 * reconcile each, every time a re-parse invalidates the offset table (review
 * finding, @handarbeit-pruefer). Returns the ids that now have a live mark.
 */
export function placeMarksForAnchors(
  editor: LexicalEditor,
  offsetSpans: readonly OffsetSpan[],
  markdownText: string,
  entries: readonly { anchor: Anchor; id: string }[],
): string[] {
  const placedIds = new Set<string>();
  if (entries.length === 0) return [];

  // Back to front. Placing a mark splits the TextNode it lands in, and
  // `offsetSpans` still describes the *unsplit* parse — so a placement
  // invalidates the table for everything after it in the document, but not for
  // anything before it (Lexical's splitText keeps the original key on the first
  // segment). Working from the last target backwards therefore keeps every
  // remaining entry's span valid. Without this, a second annotation in the same
  // paragraph fails to place. `locateInSpan` is a pure string search, so the
  // ordering pass can run outside the update.
  const ordered = entries
    .map((entry) => ({
      entry,
      at:
        locateInSpan(markdownText, entry.anchor.targetText, {
          occurrenceIndex: entry.anchor.occurrenceIndex,
          prefixContext: entry.anchor.prefixContext,
          suffixContext: entry.anchor.suffixContext,
        })?.start ?? -1,
    }))
    .sort((a, b) => b.at - a.at)
    .map((scored) => scored.entry);

  editor.update(
    () => {
      for (const entry of ordered) {
        if ($placeMarkForAnchor(offsetSpans, markdownText, entry.anchor, entry.id)) {
          placedIds.add(entry.id);
        }
      }
    },
    { discrete: true },
  );
  // Reported in the caller's order, not the back-to-front order used above.
  return entries.filter((entry) => placedIds.has(entry.id)).map((entry) => entry.id);
}

/**
 * The per-anchor placement itself. Must run inside an active `editor.update()`
 * (the `$` prefix is Lexical's convention for that), so a caller can batch many
 * placements into one reconciliation.
 */
function $placeMarkForAnchor(offsetSpans: readonly OffsetSpan[], markdownText: string, anchor: Anchor, id: string): boolean {
  if (liveMarkTexts(id).length > 0) return true;

  const located = locateInSpan(markdownText, anchor.targetText, {
    occurrenceIndex: anchor.occurrenceIndex,
    prefixContext: anchor.prefixContext,
    suffixContext: anchor.suffixContext,
  });
  if (!located) return false;

  const startPoint = pointAtMarkdownOffset(offsetSpans, located.start, 'start');
  const endPoint = pointAtMarkdownOffset(offsetSpans, located.end, 'end');
  if (!startPoint || !endPoint) return false;
  // An `OffsetSpan[]` is only valid for the parse that produced it: a
  // re-import (`$getRoot().clear()` + rebuild) destroys every node key in
  // it. Callers are expected to refresh the table with each parse — but a
  // point built from a dead key would make `$wrapSelectionInMarkNode`
  // throw on `Point.getNode()`, turning a caller's bookkeeping slip into a
  // crash inside the editor. Decline instead, same as any other
  // unmappable anchor.
  const startNode = $getNodeByKey(startPoint.key);
  const endNode = $getNodeByKey(endPoint.key);
  if (!$isTextNode(startNode) || !$isTextNode(endNode)) return false;
  // The offsets must also still fit the nodes. Placing a mark splits the
  // TextNode it lands in, so a table entry for a node that an *earlier*
  // placement already split can point past the end of what that key now holds
  // — which makes Lexical throw `$getTextNodeOffset: invalid offset` from
  // inside the update rather than returning. Decline instead. (The batch entry
  // point below also orders placements so this does not arise in practice.)
  if (startPoint.offset > startNode.getTextContentSize()) return false;
  if (endPoint.offset > endNode.getTextContentSize()) return false;
  // A start/end offset that both fall inside the same untracked gap (e.g.
  // a fenced code block, which today has no OffsetSpan coverage at all —
  // unrelated to and much wider than a formatting delimiter) would
  // otherwise snap to two DIFFERENT spans on opposite sides of that gap:
  // start forward past it, end backward before it — an inverted
  // selection that $wrapSelectionInMarkNode would silently wrap as
  // everything *between* them, i.e. the entire gap, not the intended
  // target. Reject rather than mis-place; matches the safe no-mark
  // fallback this replaced (FR-008).
  if (startPoint.span.start > endPoint.span.start) return false;

  const selection = $createRangeSelection();
  selection.anchor.set(startPoint.key, startPoint.offset, 'text');
  selection.focus.set(endPoint.key, endPoint.offset, 'text');
  $setSelection(selection);

  $wrapSelectionInMarkNode(selection, false, id);
  return true;
}

/**
 * Finds the `OffsetSpan` containing `offset` and returns the corresponding
 * Lexical text point. Two passes: an offset shared by two adjacent spans
 * (span A's exclusive `end` equals span B's `start`) prefers the span it's
 * strictly *inside* of first, only falling back to the exclusive-end match
 * for the offset at the very end of the last span — otherwise a start point
 * at that boundary would land at the end of the preceding node instead of
 * the start of the intended one.
 *
 * #47: `offsetSpans` has real, by-design gaps at every formatting delimiter
 * (a bold/italic/code/link marker isn't rendered text, so it was never
 * given a span) — and a markdown-slice target's boundary can legitimately
 * land inside one of those gaps (e.g. "**quick**"'s start offset sits on the
 * opening `**`). When neither pass above finds a containing/bordering span,
 * `direction` resolves the gap: a `start` offset snaps forward to the
 * nearest following span's own start (skip past leading syntax to the
 * rendered text it wraps); an `end` offset snaps back to the nearest
 * preceding span's own end (stop at the rendered text just before trailing
 * syntax). No span exists in that direction (the gap is at a document/block
 * edge): returns null, same as today's no-mark-placed fallback (FR-008).
 *
 * The matched `span` itself is returned alongside the point so
 * {@link placeMarkForAnchor} can sanity-check that a start/end pair snapped
 * to two spans in the wrong order (see its own doc) — a gap wide enough to
 * contain other real spans (a fenced code block, today untracked entirely)
 * can otherwise snap the start forward past it while the end snaps backward
 * before it.
 */
function pointAtMarkdownOffset(
  spans: readonly OffsetSpan[],
  offset: number,
  direction: 'start' | 'end',
): { key: string; offset: number; span: OffsetSpan } | null {
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) {
      return { key: span.nodeKey, offset: offset - span.start, span };
    }
  }
  for (const span of spans) {
    if (offset === span.end) {
      return { key: span.nodeKey, offset: offset - span.start, span };
    }
  }

  if (direction === 'start') {
    let best: OffsetSpan | null = null;
    for (const span of spans) {
      if (span.start >= offset && (!best || span.start < best.start)) best = span;
    }
    return best ? { key: best.nodeKey, offset: 0, span: best } : null;
  }

  let best: OffsetSpan | null = null;
  for (const span of spans) {
    if (span.end <= offset && (!best || span.end > best.end)) best = span;
  }
  return best ? { key: best.nodeKey, offset: best.end - best.start, span: best } : null;
}

/**
 * FR-006: the current live range of every comment with a mark in the
 * document, keyed by comment id — used at checkpoint time to decide which
 * comments' anchors actually need re-recording (only those whose current
 * range's text differs from their last durable `anchor.targetText`).
 * Comments with no live mark (orphaned, flagged, or not yet resolved into
 * the open document) are simply absent from the returned map.
 */
export function collectLiveAnchorSnapshots(editor: LexicalEditor, markdownText: string): Map<string, AnchorRange> {
  return editor.getEditorState().read(() => {
    const ids = new Set<string>();
    for (const markNode of collectMarkNodesInOrder($getRoot())) {
      for (const id of markNode.getIDs()) ids.add(id);
    }

    const snapshots = new Map<string, AnchorRange>();
    for (const id of ids) {
      const range = locateLiveMarkdownRange(markdownText, id);
      if (range) snapshots.set(id, range);
    }
    return snapshots;
  });
}

/** Whether `id` currently has a live mark anywhere in the document. */
export function hasLiveMark(editor: LexicalEditor, id: string): boolean {
  return editor.getEditorState().read(() => liveMarkTexts(id).length > 0);
}

/**
 * The real, rendered DOM elements for every live `MarkNode` wrapping `id`,
 * in document order — for `CommentMarkerPlugin` to decorate directly
 * (outcome/active class, click/keydown navigation) instead of computing a
 * synthetic overlay. Empty when `id` has no live mark (e.g. a `flagged`
 * target, which never gets one placed — see `placeMarkForAnchor` callers).
 */
export function markElementsForId(editor: LexicalEditor, id: string): HTMLElement[] {
  return editor.getEditorState().read(() => {
    const elements: HTMLElement[] = [];
    for (const markNode of collectMarkNodesInOrder($getRoot())) {
      if (!markNode.hasID(id)) continue;
      const element = editor.getElementByKey(markNode.getKey());
      if (element) elements.push(element);
    }
    return elements;
  });
}

/**
 * Removes every `MarkNode` wrapping `id` (annotation deleted, or composer
 * cancelled before submit). A mark shared with other annotation ids
 * (overlapping annotations) keeps its other ids and stays in the tree; a mark
 * left with none is unwrapped back to plain content.
 */
export function removeMarksForAnnotation(editor: LexicalEditor, id: string): void {
  editor.update(
    () => {
      for (const markNode of collectMarkNodesInOrder($getRoot())) {
        if (!markNode.hasID(id)) continue;
        const updated = markNode.deleteID(id);
        if (updated.getIDs().length === 0) $unwrapMarkNode(updated);
      }
    },
    { discrete: true },
  );
}

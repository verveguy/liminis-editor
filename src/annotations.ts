/**
 * `@liminis/editor/annotations` — the headless annotation surface (ADR-076).
 *
 * The sixth declared export subpath, added as a *considered* export under
 * ADR-075's five-subpath rule. It exists because this surface has a profile no
 * existing subpath has: it must be callable outside a rendered editor, so it
 * is free of DOM, React and Lexical — but it is not pure-mdast either (the
 * anchor schema imports `zod`), so it does not belong on `./markdown`, and it
 * must not go on `./headless`, whose `mathjax-config` re-export drags ~1.9 MB
 * of side-effectful imports.
 *
 * Everything reachable from here is safe to call from a main process, a worker,
 * or a test with no DOM. The React plugins and the marker-placement code live
 * on the root barrel alongside `<Editor>` instead.
 */

// The durable anchor model — capture, schemas, and the outcome vocabulary.
export {
  ANCHOR_SCHEMA,
  ANCHOR_RESOLUTION_SCHEMA,
  CONTEXT_WINDOW_CHARS,
  captureAnchor,
} from './annotations/anchor-model';
export type {
  Anchor,
  AnchorFields,
  AnchorRange,
  AnchorOutcome,
  AnchorResolution,
} from './annotations/anchor-model';

// The sole fuzzy-matching module (FR-003). `resolveAnchors` is the batch entry
// point hosts call; it is async because the relocation seam may be host-supplied.
export {
  resolveAnchor,
  resolveAnchors,
  similarity,
  noopProposeSemanticRelocation,
  REATTACH_THRESHOLD,
  FLAG_THRESHOLD,
} from './annotations/anchor-resolver';
export type {
  ProposeSemanticRelocation,
  ResolveAnchorOptions,
  IdentifiedAnchor,
  AnchorResolutionResult,
} from './annotations/anchor-resolver';

// Block structure — the structural context anchors are captured against.
export {
  parseBlocks,
  findEnclosingBlock,
  blockPlainText,
  sentenceChunks,
} from './annotations/block-structure';
export type { Block, BlockType, SentenceChunk } from './annotations/block-structure';

// Span alignment, used when mapping an anchor onto a live document offset span.
export { locateInSpan } from './annotations/anchor-align';
export type { SpanRange, LocateInSpanOptions } from './annotations/anchor-align';

// The annotation primitive and its per-kind configuration — the sole difference
// between the comment feature and the correction feature (SC-001).
export { shouldPlaceLiveMark, deriveMarkerTargets } from './annotations/types';
export type {
  Annotation,
  AnnotationKind,
  AnnotationKindConfig,
  AnnotationKindConfigs,
  AnnotationCreateAffordance,
  AnnotationMarkerStyle,
  AnnotationPresentation,
  AnnotationEditorHandle,
  MarkerTarget,
} from './annotations/types';

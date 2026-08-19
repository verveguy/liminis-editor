import { useEffect, useMemo, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { MutableRefObject } from 'react';
import {
  deriveMarkerTargets,
  type Annotation,
  type AnnotationEditorHandle,
  type AnnotationKindConfigs,
  type MarkerTarget,
} from '../../annotations/types';
import type { OffsetSpan } from '../mapper/mdastToLexical';
import type { WikiLinkPromotionMode } from '../mapper/lexicalToMdast';
import {
  collectLiveAnchorSnapshots,
  getMarkRects,
  placeMarksForAnchors,
  removeMarksForAnnotation,
  removeMarksForAnnotations,
} from './annotation-marks';
import { AnnotationPlugin, type AnnotationCreateEvent } from './AnnotationPlugin';
import { AnnotationMarkerPlugin } from './AnnotationMarkerPlugin';
import { registerMarkOverlapResolver } from './mark-overlap-resolver';

export interface AnnotationSurfaceProps {
  kinds: AnnotationKindConfigs;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  scrollToAnnotation?: { id: string; nonce: number } | null;
  onCreateAnnotation?: (event: AnnotationCreateEvent) => void;
  onActivateAnnotation?: (id: string) => void;
  editorHandleRef?: MutableRefObject<AnnotationEditorHandle | null>;
  offsetSpansRef: MutableRefObject<OffsetSpan[]>;
  markdownTextRef: MutableRefObject<string>;
  offsetsVersion: number;
  logger?: { warn: (message: string, ...args: unknown[]) => void };
  /** Forwarded to the anchor-capture export pass — see `Editor`'s own prop of the same name. */
  wikiLinkPromotion?: WikiLinkPromotionMode;
}

/**
 * Places a live `MarkNode` for every marker target — the set `deriveMarkerTargets`
 * already narrowed by each kind's live-mark policy.
 *
 * This is also where the spec's "document edited mid-resolution" edge case is
 * handled, and it needs no dedicated guard: `placeMarkForAnchor` re-verifies
 * the anchor's target text against the *current* offset spans and returns
 * false rather than placing on unrelated text. A stale anchor therefore
 * no-ops, and the next parse bumps `offsetsVersion`, which re-runs this pass
 * against fresh spans. Placement is never applied on the strength of an
 * out-of-date resolution.
 */
function AnnotationMarkPlacementPlugin({
  offsetSpansRef,
  markdownTextRef,
  targets,
  offsetsVersion,
}: {
  offsetSpansRef: MutableRefObject<OffsetSpan[]>;
  markdownTextRef: MutableRefObject<string>;
  targets: MarkerTarget[];
  offsetsVersion: number;
}) {
  const [editor] = useLexicalComposerContext();
  // Ids this plugin has placed a mark for. Retracting a mark is keyed off this
  // rather than off "every mark in the document" on purpose: a comment created
  // through `AnnotationPlugin` with `retainMarkOnCreate` keeps its mark while
  // the host is still deciding whether to persist it, and that mark is not
  // ours to remove.
  const placedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // No outcome filter here: `deriveMarkerTargets` has already applied each
    // kind's `livemarkPolicy` (defaulting to `shouldPlaceLiveMark` over the
    // outcome). Re-testing the outcome would let the policy only ever subtract
    // — a host that deliberately opts a `flagged` annotation into a live mark
    // would get a marker target the marker plugin then decorates but nothing
    // ever places, which is the one inconsistency the single policy exists to
    // prevent.
    const eligible = new Set(targets.map((target) => target.annotationId));

    // Retract first: an annotation the host removed, or whose outcome or
    // live-mark policy now declines it, must lose the mark it was given.
    // Without this the MarkNode survives every later pass — still in the
    // document, still rendering as a bare <mark>, and no longer decorated by
    // the marker plugin (which only walks current targets), so it becomes an
    // undismissable highlight with nothing behind it.
    // Batched for the same reason placement is: a host dropping a set of live
    // annotations at once would otherwise pay one synchronous Lexical
    // reconciliation per id (review finding, @handarbeit-pruefer).
    const retract = [...placedRef.current].filter((id) => !eligible.has(id));
    if (retract.length > 0) {
      removeMarksForAnnotations(editor, retract);
      for (const id of retract) placedRef.current.delete(id);
    }

    // One batched update for the whole set, not one per annotation: an
    // `offsetsVersion` bump re-runs this pass over every target, and a
    // per-target `editor.update()` would force a synchronous Lexical
    // reconciliation each time (review finding, @handarbeit-pruefer).
    const placed = placeMarksForAnchors(
      editor,
      offsetSpansRef.current,
      markdownTextRef.current,
      targets.map((target) => ({ anchor: target.anchor, id: target.annotationId })),
    );
    for (const id of placed) placedRef.current.add(id);
    // The two refs are read fresh on every run; offsetsVersion (bumped whenever
    // a (re)parse produces new spans) is what should actually re-trigger this.
  }, [editor, targets, offsetsVersion, offsetSpansRef, markdownTextRef]);

  return null;
}

/**
 * Keeps overlapping annotations on *shared* MarkNodes rather than nested ones
 * — see `mark-overlap-resolver.ts`. Mounted here because it is only meaningful
 * once annotation kinds are configured, and this whole module is lazily loaded
 * on exactly that condition.
 */
function MarkOverlapResolverPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerMarkOverlapResolver(editor), [editor]);
  return null;
}

/**
 * Publishes the live-mark mechanism to the host via an imperative ref — the
 * host lives outside this LexicalComposer tree and has no other way to reach
 * the editor instance.
 */
function AnnotationEditorHandlePlugin({
  handleRef,
  wikiLinkPromotion,
}: {
  handleRef: MutableRefObject<AnnotationEditorHandle | null>;
  wikiLinkPromotion?: WikiLinkPromotionMode;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    handleRef.current = {
      removeMarksForAnnotation: (id) => removeMarksForAnnotation(editor, id),
      collectLiveAnchorSnapshots: (markdownText) =>
        collectLiveAnchorSnapshots(editor, markdownText, { wikiLinkPromotion }),
      getMarkRects: (annotationIds) => getMarkRects(editor, annotationIds),
    };
    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef, wikiLinkPromotion]);

  return null;
}

/**
 * The entire annotation feature surface, behind one lazily-imported boundary.
 *
 * Nothing here is reachable from `Editor.tsx` by static import: the editor
 * loads this module only when a host actually configures annotation kinds
 * (FR-004/SC-004). That is why the create plugin, marker plugin, placement and
 * editor handle are assembled here rather than mounted individually.
 */
export default function AnnotationSurface({
  kinds,
  annotations,
  activeAnnotationId,
  scrollToAnnotation,
  onCreateAnnotation,
  onActivateAnnotation,
  editorHandleRef,
  offsetSpansRef,
  markdownTextRef,
  offsetsVersion,
  logger,
  wikiLinkPromotion,
}: AnnotationSurfaceProps) {
  const targets = useMemo(() => deriveMarkerTargets(annotations, kinds), [annotations, kinds]);

  // An annotation whose kind has no configuration is dropped by
  // deriveMarkerTargets; surface that as a warning rather than silently
  // ignoring the host's data.
  useEffect(() => {
    for (const annotation of annotations) {
      if (!kinds[annotation.kind]) {
        logger?.warn(
          `[annotations] annotation ${annotation.id} has unconfigured kind "${annotation.kind}"; ignoring`,
        );
      }
    }
  }, [annotations, kinds, logger]);

  return (
    <>
      {/* Registered before the placement plugin so an overlap created by the
          very first placement pass is already un-nested by the transform. */}
      <MarkOverlapResolverPlugin />
      {onCreateAnnotation && (
        <AnnotationPlugin
          kinds={kinds}
          onCreateAnnotation={onCreateAnnotation}
          logger={logger}
          wikiLinkPromotion={wikiLinkPromotion}
        />
      )}
      <AnnotationMarkPlacementPlugin
        offsetSpansRef={offsetSpansRef}
        markdownTextRef={markdownTextRef}
        targets={targets}
        offsetsVersion={offsetsVersion}
      />
      <AnnotationMarkerPlugin
        targets={targets}
        kinds={kinds}
        activeAnnotationId={activeAnnotationId}
        onActivateAnnotation={onActivateAnnotation ?? (() => undefined)}
        scrollToAnnotation={scrollToAnnotation}
      />
      {editorHandleRef && (
        <AnnotationEditorHandlePlugin handleRef={editorHandleRef} wikiLinkPromotion={wikiLinkPromotion} />
      )}
    </>
  );
}

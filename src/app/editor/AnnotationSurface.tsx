import { useEffect, useMemo } from 'react';
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
import {
  collectLiveAnchorSnapshots,
  placeMarkForAnchor,
  removeMarksForAnnotation,
} from './annotation-marks';
import { AnnotationPlugin, type AnnotationCreateEvent } from './AnnotationPlugin';
import { AnnotationMarkerPlugin } from './AnnotationMarkerPlugin';

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

  useEffect(() => {
    // No outcome filter here: `deriveMarkerTargets` has already applied each
    // kind's `livemarkPolicy` (defaulting to `shouldPlaceLiveMark` over the
    // outcome). Re-testing the outcome would let the policy only ever subtract
    // — a host that deliberately opts a `flagged` annotation into a live mark
    // would get a marker target the marker plugin then decorates but nothing
    // ever places, which is the one inconsistency the single policy exists to
    // prevent.
    for (const target of targets) {
      placeMarkForAnchor(
        editor,
        offsetSpansRef.current,
        markdownTextRef.current,
        target.anchor,
        target.annotationId,
      );
    }
    // The two refs are read fresh on every run; offsetsVersion (bumped whenever
    // a (re)parse produces new spans) is what should actually re-trigger this.
  }, [editor, targets, offsetsVersion, offsetSpansRef, markdownTextRef]);

  return null;
}

/**
 * Publishes the live-mark mechanism to the host via an imperative ref — the
 * host lives outside this LexicalComposer tree and has no other way to reach
 * the editor instance.
 */
function AnnotationEditorHandlePlugin({
  handleRef,
}: {
  handleRef: MutableRefObject<AnnotationEditorHandle | null>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    handleRef.current = {
      removeMarksForAnnotation: (id) => removeMarksForAnnotation(editor, id),
      collectLiveAnchorSnapshots: (markdownText) => collectLiveAnchorSnapshots(editor, markdownText),
    };
    return () => {
      handleRef.current = null;
    };
  }, [editor, handleRef]);

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
      {onCreateAnnotation && (
        <AnnotationPlugin kinds={kinds} onCreateAnnotation={onCreateAnnotation} logger={logger} />
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
      {editorHandleRef && <AnnotationEditorHandlePlugin handleRef={editorHandleRef} />}
    </>
  );
}

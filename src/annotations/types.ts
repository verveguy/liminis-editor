/**
 * Unified annotation types (ADR-077).
 *
 * An annotation is a range-anchored marker over document text. Comments and
 * corrections are not separate features here — they are two *kinds*, differing
 * only by the {@link AnnotationKindConfig} a host supplies. Everything in this
 * module is DOM-free, Lexical-free and React-free so it can be reached from the
 * `./annotations` subpath and used outside a rendered editor.
 *
 * Per ADR-075 the seam is persistence: the package owns anchor mechanics and
 * marker rendering; identity, storage and lifecycle (resolve/reopen for
 * comments, accept/reject for corrections) stay in the consuming app. The
 * package treats `id` as opaque and `payload` as pass-through.
 */
import type { Anchor, AnchorOutcome, AnchorRange } from './anchor-model'

// ============================================================================
// The annotation primitive
// ============================================================================

/**
 * Which kind of annotation this is. Deliberately a plain string rather than a
 * closed union — a host may configure kinds the package has never heard of,
 * and the two Liminis/Zusammen kinds carry no special status in the mechanism.
 */
export type AnnotationKind = string

/** Presentation hints a host may attach per annotation, overriding kind defaults. */
export interface AnnotationPresentation {
  /** Extra CSS class applied to this annotation's marker element. */
  className?: string
  /** Accessible label for the marker; falls back to the kind name. */
  label?: string
}

/**
 * A range-anchored marker over document text. `id` is opaque to the package —
 * hosts mint and persist it. `payload` is carried through untouched and handed
 * back on activation, so a host can round-trip its own domain object without
 * the package understanding it.
 */
export interface Annotation<TPayload = unknown> {
  id: string
  kind: AnnotationKind
  anchor: Anchor
  /**
   * The resolution outcome currently in effect for this anchor. Hosts compute
   * this (via `resolveAnchors` or their own store) — the package never
   * classifies on the host's behalf. Defaults to `unchanged` when omitted.
   */
  outcome?: AnchorOutcome
  presentation?: AnnotationPresentation
  payload?: TPayload
}

// ============================================================================
// Kind configuration — the sole difference between comments and corrections
// ============================================================================

/**
 * How a kind's markers paint. `none` places no visible marker at all, which is
 * what corrections use: they adopt the anchor model and the capture primitive
 * but render exactly what they render today — nothing (FR-006 parity).
 */
export type AnnotationMarkerStyle = 'highlight' | 'squiggle' | 'none'

/** Where a kind's user-initiated create affordance is offered, if anywhere. */
export interface AnnotationCreateAffordance {
  surface: 'toolbar' | 'contextMenu'
  label?: string
}

/**
 * The per-kind configuration record. SC-001's claim rests on this type: a
 * reviewer can point at two values of it as the entire difference between the
 * comment feature and the correction feature.
 */
export interface AnnotationKindConfig<TPayload = unknown> {
  markerStyle: AnnotationMarkerStyle
  /**
   * User-initiated creation. Omitted or null means host-injected only — the
   * package offers no way for a user to create one.
   */
  createAffordance?: AnnotationCreateAffordance | null
  /**
   * Whether this annotation gets a live `MarkNode` in the document. Defaults to
   * {@link shouldPlaceLiveMark} over the annotation's outcome when omitted.
   *
   * Consulted only when `markerStyle` is not `none` — see
   * {@link deriveMarkerTargets} for why that precedence exists.
   */
  livemarkPolicy?: (annotation: Annotation<TPayload>) => boolean
  /**
   * Whether the capture primitive leaves its transient mark in place after
   * capturing an anchor. Comments retain it (the composer highlights the
   * passage); corrections discard it.
   *
   * The discard is *not* part of the wrapping update. `AnnotationPlugin` wraps
   * inside the command handler, then reads the anchor back and removes the
   * mark on a `queueMicrotask` — the read cannot be inline, because a command
   * handler runs inside an active Lexical update and the nested wrap is not
   * observable until that update flushes. The guarantee is therefore "removed
   * before the browser paints" (microtasks drain ahead of paint), not "removed
   * in the same update". Anything that pushes the discard past a task boundary
   * — an `await`, a `setTimeout`, a `requestAnimationFrame` — would let the
   * mark flash visibly first.
   */
  retainMarkOnCreate?: boolean
}

/** A host's full annotation configuration: kind name → its config. */
export type AnnotationKindConfigs = Record<AnnotationKind, AnnotationKindConfig>

// ============================================================================
// Marker targets
// ============================================================================

/**
 * A resolved instruction to place one marker. Ported from Zusammen's
 * `comment-thread.ts`; its `deriveMarkerTargets` is deliberately *not* ported —
 * that function takes Zusammen's `Thread`/`Comment`, which are app-domain under
 * ADR-075. The package accepts already-derived annotations instead.
 */
export interface MarkerTarget {
  annotationId: string
  kind: AnnotationKind
  anchor: Anchor
  outcome: AnchorOutcome
  /**
   * Carried through from the source annotation. The marker renderer sees only
   * targets, so without this the per-annotation className/label overrides
   * {@link AnnotationPresentation} promises would be silently unreachable.
   */
  presentation?: AnnotationPresentation
}

/**
 * Whether `outcome` gets a live in-document `MarkNode` at all. Only
 * `unchanged`/`re-attached` do — `flagged`'s match is uncertain and `orphaned`
 * has nothing left to point at, so both stay panel-only, never placed on text
 * the resolver wasn't confident about.
 */
export function shouldPlaceLiveMark(outcome: AnchorOutcome): boolean {
  return outcome === 'unchanged' || outcome === 're-attached'
}

/**
 * Derive marker targets from host-supplied annotations, applying each kind's
 * live-mark policy. Annotations whose `kind` has no configuration are dropped;
 * the caller is responsible for warning about them (the logger is injected at
 * the React layer, and this module stays dependency-free).
 *
 * `markerStyle: 'none'` takes precedence over `livemarkPolicy` and yields no
 * target at all. A target is not merely a styling instruction — it is what
 * makes `AnnotationMarkPlacementPlugin` wrap the text in a real `MarkNode`,
 * which reaches the DOM as a `<mark>` element. `AnnotationMarkerPlugin` skips
 * decoration for `none`, so that element would carry no `annotation-mark-*`
 * class, and `styles.css` neutralizes the UA's default yellow `<mark>`
 * background only under those classes — leaving a persistent uncontrolled
 * highlight, the exact opposite of what `none` promises. Gating here rather
 * than at paint time keeps the promise structural instead of leaving it to a
 * host remembering to pair `none` with `livemarkPolicy: () => false`.
 */
export function deriveMarkerTargets(
  annotations: readonly Annotation[],
  kinds: AnnotationKindConfigs,
): MarkerTarget[] {
  const targets: MarkerTarget[] = []

  for (const annotation of annotations) {
    const config = kinds[annotation.kind]
    if (!config) continue

    if (config.markerStyle === 'none') continue

    const outcome = annotation.outcome ?? 'unchanged'
    const placeLive = config.livemarkPolicy
      ? config.livemarkPolicy(annotation)
      : shouldPlaceLiveMark(outcome)
    if (!placeLive) continue

    targets.push({
      annotationId: annotation.id,
      kind: annotation.kind,
      anchor: annotation.anchor,
      outcome,
      presentation: annotation.presentation,
    })
  }

  return targets
}

// ============================================================================
// Editor handle
// ============================================================================

/**
 * The imperative bridge from a host to the live marks inside a mounted editor —
 * set once the editor mounts, read by the host at delete-time and
 * checkpoint-time. Ported from Zusammen's `comment-editor-handle.ts`.
 */
export interface AnnotationEditorHandle {
  /** Removes every live mark wrapping `annotationId` (annotation deleted, or composer cancelled). */
  removeMarksForAnnotation: (annotationId: string) => void
  /** The current live range of every marked passage, keyed by annotation id. */
  collectLiveAnchorSnapshots: (markdownText: string) => Map<string, AnchorRange>
}

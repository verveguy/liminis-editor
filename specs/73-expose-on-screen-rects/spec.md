# Feature Specification: Expose On-Screen Rects for Existing Annotation Marks (`getMarkRects`)

**Feature Branch**: `fabrik/issue-73`
**Created**: 2026-08-18
**Status**: Specified
**Input**: User description: "Expose the on-screen position of existing annotation marks, so a host can lay out UI aligned to the text a mark covers."

## Background

A host embedding `@liminis/editor` can create annotations, remove them, and read their live anchor ranges — but it has no way to find out **where any of them currently is on screen**. Verified against `main` at `0.2.0`:

| what exists | where | why it doesn't help |
|---|---|---|
| `AnnotationCreateEvent.rect: DOMRect` | exported from `src/index.ts`, populated in `AnnotationPlugin.tsx` | One-shot, delivered only at creation time — "where the selection was on screen, for hosts that position a composer." Nothing for a mark that already exists, and stale the moment the document scrolls or reflows. |
| `removeMarksForAnnotation(id)` | `AnnotationEditorHandle`, `src/annotations/types.ts:213` | Not positional. |
| `collectLiveAnchorSnapshots(markdownText)` | `AnnotationEditorHandle`, `src/annotations/types.ts:215` | Returns `AnchorRange`s — *document* offsets, not screen geometry. |

There is no exported `get*Rect*` API of any kind; the only `getBoundingClientRect` calls in the package are internal (`AnnotationPlugin.tsx`).

There is also no app-side workaround available to a host. Marks render as `@lexical/mark` `MarkNode`s, styled by class (`.annotation-mark-highlight`, `.annotation-mark-squiggle`). The class carries the mark's *style*, not its *identity* — Lexical holds annotation ids in `__ids` in editor state, never as a DOM attribute. A host can find mark elements in the DOM but cannot tell which annotation any given element belongs to, so it cannot attribute a rect to an annotation id without package help.

This blocks [verveguy/zusammen#126](https://github.com/verveguy/zusammen/issues/126) ("Comments as margin notes aligned to the text"), which cannot be built at all without a positional API for existing marks. It is not a Zusammen-specific need: any host that wants to align UI to annotated text — a margin rail, a minimap, a connector line — needs the same capability. The `rect` already delivered on the create event shows the package accepts that hosts position UI against marks; it currently just stops after the first one.

This must ship in a published release, not just land on `main`: #126 consumes `@liminis/editor` from the registry, so the capability is not usable downstream until a `0.2.x` version containing it is published.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Host retrieves current screen geometry for an existing annotation (Priority: P1)

A host holds an annotation id for a mark that was created earlier in the session (or restored from a saved document). It asks the editor for that annotation's current on-screen geometry and receives the rect(s) covering the mark(s) as currently rendered, so it can position host UI (e.g. a margin note) against the annotated text.

**Why this priority**: This is the capability the issue exists to add — everything else in this spec supports it.

**Independent Test**: With an annotation created and its `MarkNode`(s) rendered in the DOM, call the new API with that annotation's id and confirm the returned geometry matches `getBoundingClientRect()` on the corresponding DOM element(s).

**Acceptance Scenarios**:

1. **Given** an annotation whose mark is rendered as a single `MarkNode`, **When** a host requests that annotation's rects, **Then** it receives geometry that matches that node's current `getBoundingClientRect()`.
2. **Given** an annotation whose mark spans several sibling `MarkNode`s (a multi-line or multi-block annotation, the case already documented in `annotation-marks.ts:36`), **When** a host requests that annotation's rects, **Then** it receives one rect per constituent `MarkNode`, not a single merged rect — computing a union or picking a specific line is left to the host.
3. **Given** the document has scrolled, resized, or been edited since the last request, **When** a host requests rects again, **Then** the geometry returned reflects the DOM as it is at the time of that call, not a cached value from an earlier call.

---

### User Story 2 - Host retrieves rects for multiple annotations at once (Priority: P2)

A host that renders UI for many annotations at once (e.g. a margin rail listing every comment) wants geometry for a whole set of annotations, or for all currently live annotations, without issuing one call per id.

**Why this priority**: Directly named in the issue's proposed shape (`annotationIds?: string[]`) and required by #126's margin-rail use case; without it, a host doing bulk layout would need one call per annotation.

**Independent Test**: With several annotations live, request rects for a subset of ids and confirm only those ids' geometry is returned; request rects with no ids specified and confirm geometry for every annotation with a currently live mark is returned.

**Acceptance Scenarios**:

1. **Given** multiple live annotations, **When** a host requests rects for a specific subset of annotation ids, **Then** the result contains geometry only for the requested ids that currently have live marks.
2. **Given** multiple live annotations, **When** a host requests rects without specifying any ids, **Then** the result contains geometry for every annotation that currently has at least one live mark.

---

### Edge Cases

- An annotation id is requested that does not correspond to any currently live mark (never created, already removed, or not yet rendered). The exact contract for this case — omitted from the result vs. present with an empty array — is left to Plan to decide alongside the other API-shape questions below; either way, requesting a nonexistent or non-live id MUST NOT throw.
- An annotation exists but its marks are not currently attached to the DOM (e.g. mid-edit transition). This must not throw; behavior (empty result vs. omission) follows the same contract as the previous case.
- A multi-block annotation's constituent `MarkNode`s may not be visually adjacent (e.g. separated by a paragraph break) — the returned `DOMRect[]` must include a rect for each constituent node so the host can distinguish this from a single contiguous span.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The annotation host handle (`AnnotationEditorHandle`) MUST expose a method that returns current on-screen geometry for existing, currently-rendered annotation marks, keyed by annotation id.
- **FR-002**: The method MUST accept an optional list of annotation ids to scope the result to; when omitted, it MUST return geometry for every annotation that currently has at least one live mark.
- **FR-003**: For an annotation whose live marks span multiple sibling `MarkNode`s, the method MUST return one rect per constituent node (`DOMRect[]`), not a single merged rect, so the host — not the package — decides how to combine them (union, first line, etc.).
- **FR-004**: The method MUST return a snapshot of current geometry as of the call; it MUST NOT return cached or stale geometry from a prior call, scroll position, or layout state.
- **FR-005**: The method MUST NOT throw when queried with an id that has no currently live mark (unknown id, removed annotation, or not yet rendered).
- **FR-006**: This capability MUST be included in a published `0.2.x` release of `@liminis/editor` — landing on `main` alone does not satisfy the issue, since #126 consumes the package from the registry, not from `main`.

### Key Entities

- **Annotation mark rect query**: a host-initiated request for the current viewport geometry of one or more annotations' live marks, scoped by an optional set of annotation ids, returning geometry keyed by annotation id.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host can retrieve current on-screen geometry for any existing annotation's live mark(s) by id, without first locating or attributing DOM elements itself.
- **SC-002**: For an annotation spanning multiple sibling `MarkNode`s, the host receives one rect per constituent node, sufficient to compute a union or select an individual line.
- **SC-003**: Two calls separated by a scroll, resize, or edit return geometry consistent with the DOM state at the time of each respective call (no staleness from caching).
- **SC-004**: A host can request geometry for a specific subset of annotation ids, or for all currently live annotations in one call, without issuing one call per annotation.
- **SC-005**: The capability is available to downstream consumers via a published `0.2.x` version of `@liminis/editor` on the registry, not only on `main`.

## Assumptions

- The API is added to the existing `AnnotationEditorHandle` surface (alongside `removeMarksForAnnotation` and `collectLiveAnchorSnapshots`) rather than introduced as a new export; this matches the issue's proposed shape and the existing handle's role as the place positional/mutating operations on live marks live. Whether it instead belongs on the host-services seam is one of the deferred questions below, and Plan may revisit this.
- The editor does not virtualize document content (marks scrolled out of the current viewport remain attached to the DOM and continue to yield valid, if off-screen, `getBoundingClientRect()` results) — carried from the issue's framing; Research should confirm this holds.

## Out of Scope

- Deciding **staleness handling**: whether this is a pull-based snapshot the host re-requests, or whether the package also exposes a subscription/observer for continuous updates. Explicitly left to Plan.
- Deciding **coordinate space**: viewport-relative (raw `getBoundingClientRect`) vs. relative to the editor's scroll container. Explicitly left to Plan.
- Deciding **surface placement**: whether this method lives on the annotation host handle or becomes a positional member of the host-services seam (a question raised because #69 deliberately kept scroll-container discovery package-local, and this is the second consumer wanting something positional). Explicitly left to Plan.
- Any change to `AnnotationCreateEvent.rect` or the creation-time rect delivery path — this issue is only about geometry for marks that already exist.
- Cutting or publishing the `0.2.x` release itself (the mechanics of versioning/publishing) — FR-006/SC-005 require the capability to *be part of* a published release, not that this issue perform the release.
- Re-pointing #126's `blocked by` dependency from #69 to this issue — a bookkeeping action on a downstream repository, not part of this issue's implementation.

## Source References

- `src/index.ts` — exports `AnnotationCreateEvent`, `AnnotationEditorHandle`, and related annotation types; the new method's export surface.
- `src/annotations/types.ts:211-216` — `AnnotationEditorHandle` interface, where `removeMarksForAnnotation` and `collectLiveAnchorSnapshots` currently live.
- `src/app/editor/AnnotationPlugin.tsx` — source of the existing one-shot `rect` on `AnnotationCreateEvent`; internal `getBoundingClientRect` usage to model the new API on.
- `src/app/editor/annotation-marks.ts:33-41` — documents the multi-sibling-`MarkNode` case for a single annotation, the reason the API returns `DOMRect[]` rather than a single rect.
- `src/app/editor/AnchorScrollPlugin.tsx` — existing internal scroll-container discovery, relevant to the deferred coordinate-space question.
- Issue #69 (closed) — deliberately kept scroll-container discovery package-local rather than adding host-seam surface; relevant precedent for the deferred surface-placement question.
- verveguy/zusammen#126 — the downstream consumer blocked by this issue; its `blocked by` dependency should be re-pointed here once this issue is filed (tracked as a downstream bookkeeping action, out of scope here).

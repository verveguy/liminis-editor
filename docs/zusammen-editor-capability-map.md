# Zusammen Editor-Domain Capability Map

**Date:** 2026-08-04
**Issue:** #939 (Phase 2 — unified annotation mechanism), FR-008 / US3 / SC-006
**Related:** ADR-077 (the unified annotation primitive), ADR-075 (the package boundary)

## Why this document exists

Zusammen (`verveguy/zusammen`) maintains its own copy of this editor, plus the
anchor modules under `app/src/shared/`. Its adoption of `@liminis/editor` is a
follow-up in that repository — out of scope here. What *is* in scope is proving
the public API can serve it, because if there is a gap, adoption forces a fork
or a deep import, which is the exact failure ADR-075 exists to prevent.

This maps every editor-domain capability Zusammen has today to a symbol
reachable from one of the package's declared export subpaths. It is checkable by
reading it against `packages/editor/package.json`'s `exports` and the barrel
files, without running Zusammen.

**Result: zero unmet capabilities.** Three symbols are recorded as deliberate
app-domain exclusions rather than gaps — see the last section for why each one
is not the package's to provide.

Package subpaths referenced below:

| Subpath | Barrel |
|---|---|
| `.` | `packages/editor/src/index.ts` |
| `./annotations` | `packages/editor/src/annotations.ts` |
| `./markdown` | `packages/editor/src/markdown.ts` |
| `./headless` | `packages/editor/src/headless.ts` |
| `./contract` | `packages/editor/src/contract.ts` |
| `./styles.css` | `packages/editor/src/styles.css` |

### One adoption requirement that is not a symbol

`./styles.css` carries the default `annotation-mark-*` rules, and **the host has
to import it** — the package does not inject it, because a CSS import inside
`<Editor>` or the root barrel would force a stylesheet on markdown-only
consumers too. Zusammen should add:

```ts
import '@liminis/editor/styles.css'
```

alongside its `<Editor>` mount. Skipping it is not a build error and not a
runtime error: anchors resolve, marks place, activation fires, and nothing
renders. Called out here rather than left to discovery because Liminis cannot
surface it — its only kind is `markerStyle: 'none'`, so it never places a mark
whose styling could be missing. See ADR-077, "Marker styling ships with the
package".

---

## 1. `app/src/shared/anchor-model.ts`

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `Anchor` | `Anchor` | `./annotations` |
| `AnchorFields` | `AnchorFields` | `./annotations` |
| `AnchorRange` | `AnchorRange` | `./annotations` |
| `AnchorOutcome` | `AnchorOutcome` | `./annotations` |
| `AnchorResolution` | `AnchorResolution` | `./annotations` |
| `ANCHOR_SCHEMA` | `ANCHOR_SCHEMA` | `./annotations` |
| `ANCHOR_RESOLUTION_SCHEMA` | `ANCHOR_RESOLUTION_SCHEMA` | `./annotations` |
| `CONTEXT_WINDOW_CHARS` | `CONTEXT_WINDOW_CHARS` | `./annotations` |
| `captureAnchor` | `captureAnchor` | `./annotations` |

Ported verbatim; `anchor-model.test.ts` carries over and passes unmodified
except for import paths.

## 2. `app/src/shared/anchor-resolver.ts`

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `resolveAnchor` | `resolveAnchor` | `./annotations` |
| `ResolveAnchorOptions` | `ResolveAnchorOptions` | `./annotations` |
| `ProposeSemanticRelocation` | `ProposeSemanticRelocation` | `./annotations` |
| `noopProposeSemanticRelocation` | `noopProposeSemanticRelocation` | `./annotations` |
| `similarity` | `similarity` | `./annotations` |
| `REATTACH_THRESHOLD` | `REATTACH_THRESHOLD` | `./annotations` |
| `FLAG_THRESHOLD` | `FLAG_THRESHOLD` | `./annotations` |
| *(no equivalent — new)* | `resolveAnchors`, `IdentifiedAnchor`, `AnchorResolutionResult` | `./annotations` |

`resolveAnchors` is a batch wrapper added for the public surface (FR-002); it
fans out over the same `resolveAnchor` path, so classification is unchanged.
Zusammen's `main/comment-anchoring.ts` currently loops `resolveAnchor` itself
behind its `comments:resolveAnchors` IPC handler and can call the wrapper
instead.

This module is the **sole** fuzzy-matching module for anchor re-resolution
(FR-003). `anchor-resolver.test.ts` carries over unmodified.

## 3. `app/src/shared/block-structure.ts`

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `BlockType` | `BlockType` | `./annotations` |
| `Block` | `Block` | `./annotations` |
| `SentenceChunk` | `SentenceChunk` | `./annotations` |
| `parseBlocks` | `parseBlocks` | `./annotations` |
| `findEnclosingBlock` | `findEnclosingBlock` | `./annotations` |
| `blockPlainText` | `blockPlainText` | `./annotations` |
| `sentenceChunks` | `sentenceChunks` | `./annotations` |

Ported verbatim; `block-structure.test.ts` carries over unmodified.

## 4. `app/src/shared/comment-anchor-align.ts` → `annotations/anchor-align.ts`

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `locateInSpan` | `locateInSpan` | `./annotations` |
| `SpanRange` | `SpanRange` | `./annotations` |
| `LocateInSpanOptions` | `LocateInSpanOptions` | `./annotations` |

Renamed on port (the module is no longer comment-specific). Its test carries
over unmodified.

## 5. `app/src/shared/comment-editor-handle.ts`

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `CommentEditorHandle` | `AnnotationEditorHandle` | `./annotations` and `.` |

Renamed, and its `removeMarksForComment` member is `removeMarksForAnnotation`.
`collectLiveAnchorSnapshots` keeps its name and signature. The handle is
populated by passing `annotationEditorHandleRef` to `<Editor>`; Zusammen's host
reads it exactly as it does today.

## 6. `app/src/shared/comment-thread.ts` — editor-domain parts only

| Zusammen symbol | Package export | Subpath |
|---|---|---|
| `MarkerTarget` | `MarkerTarget` | `./annotations` and `.` |
| `shouldPlaceLiveMark` | `shouldPlaceLiveMark` | `./annotations` |
| `deriveMarkerTargets` | `deriveMarkerTargets` (re-expressed — see below) | `./annotations` |

`MarkerTarget`'s `threadId` field is `annotationId` in the package, and it gains
a `kind`. `shouldPlaceLiveMark` is identical, and the `shouldPlaceLiveMark`
block of `comment-thread.test.ts` carries over.

`deriveMarkerTargets` is **re-expressed, not ported**: Zusammen's takes
`readonly Thread[]` and reaches into `thread.root` (a `Comment`), both of which
are app-domain types under ADR-075. The package's takes
`(annotations, kinds)`. Zusammen keeps its own thread→annotation projection —
a few lines over types it already owns — and calls the package's version, or
skips it entirely and passes `annotations` to `<Editor>`, which derives targets
internally.

## 7. `app/src/editor/app/editor/comment-anchor-marks.ts`

Ported to `app/editor/annotation-marks.ts`. These are package-internal: they are
Lexical-bound and are consumed by the package's own plugins, which now provide
the behaviour Zusammen wired up by hand. The capability each one provided is
still reachable, as shown:

| Zusammen symbol | How the capability is reached | Subpath |
|---|---|---|
| `wrapNativeRangeInMark` | `<Editor onCreateAnnotation>` + `OPEN_ANNOTATION_COMPOSER_COMMAND` | `.` |
| `readAnchorFields` | same — the captured anchor arrives on `AnnotationCreateEvent.anchor` | `.` |
| `placeMarkForAnchor` | `<Editor annotations>` — the surface places marks per the kind's live-mark policy | `.` |
| `collectLiveAnchorSnapshots` | `AnnotationEditorHandle.collectLiveAnchorSnapshots` | `.` |
| `removeMarksForComment` | `AnnotationEditorHandle.removeMarksForAnnotation` | `.` |
| `hasLiveMark` | not exported — see "Known gaps" | — |
| `markElementsForId` | not exported — see "Known gaps" | — |

## 8. Editor plugins

| Zusammen module | Package equivalent | Subpath |
|---|---|---|
| `CommentSelectionPlugin.tsx` | `AnnotationPlugin` (mounted by `<Editor>`) | via `.` |
| `CommentMarkerPlugin.tsx` | `AnnotationMarkerPlugin` (mounted by `<Editor>`) | via `.` |
| `commentCommands.ts` | `OPEN_ANNOTATION_COMPOSER_COMMAND` | `.` |
| `Editor.tsx`'s `CommentMarkPlacementPlugin` | internal to `AnnotationSurface`, driven by `annotations` | via `.` |
| `Editor.tsx`'s `CommentEditorHandlePlugin` | internal, driven by `annotationEditorHandleRef` | via `.` |

The plugins are not exported individually and do not need to be: `<Editor>`
mounts them from `annotationKinds`. One behavioural difference Zusammen should
know about — `CommentSelectionPlugin` renders its own composer (a textarea with
Cancel/Comment buttons); `AnnotationPlugin` is headless and fires
`onCreateAnnotation` with the captured anchor and the selection rect instead.
The composer is host UX under ADR-075, so Zusammen brings its own. This is a
deliberate boundary choice, not a missing capability.

## 9. `app/src/editor/app/mapper/` — mark transparency

| Zusammen capability | Package equivalent | Subpath |
|---|---|---|
| `effectiveChildren` mark-transparency | applied unconditionally inside `exportLexicalToMdast` | `.` |
| `setAnnotateTarget` | package-internal (used by the capture primitive) | — |
| `markOpenToken` / `markCloseToken` | package-internal | — |
| `OffsetSpan` + `importMarkdownToLexical*WithOffsets` | package-internal; `<Editor>` collects spans itself | — |

Mark transparency is a property of the export, not an API: a document with live
marks exports byte-identically to the same document without them, asserted
across the whole round-trip fixture corpus. Zusammen gets it by using the
package's mapper at all.

The sentinel and offset machinery is internal because its only consumer is the
capture primitive, which the package now owns. Zusammen had to expose them
because its host drove capture directly; it no longer does.

---

## Known gaps

None that block adoption. Two symbols are intentionally unexported, with a
rationale and a cheap escalation path:

**`hasLiveMark(editor, id)` and `markElementsForId(editor, id)`.** Both take a
`LexicalEditor`, which a host outside the composer tree does not have. In
Zusammen both are used *inside* the editor tree — by `CommentMarkerPlugin` for
decoration and scroll-to — and the package's `AnnotationMarkerPlugin` now does
that work. If Zusammen finds a host-side use during adoption, the fix is to add
them to `AnnotationEditorHandle`, which already exists for exactly this purpose
and is the same one-line-per-method change `removeMarksForAnnotation` was. That
is a considered export under ADR-075, not a fork.

## Deliberate app-domain exclusions

These are **not gaps**. Each stays app-side because ADR-075 draws the seam at
persistence, and each of these is on the persistence side of it.

| Symbol | Why it stays in Zusammen |
|---|---|
| `deriveMarkerTargets(threads: Thread[])` (original signature) | Takes `Thread`/`Comment` — Zusammen's own persistence model. The package cannot know their shape without importing the app's domain. Re-expressed over `Annotation[]` instead. |
| `anchorOutcomeOf(comment: Comment)` | Reads a comment's last resolution event out of the WAL-reconstructed comment. That is Zusammen's event store's business; the package accepts an already-computed `outcome` on each annotation. |
| `deriveWorkspaceCommentList` | App-domain by the issue's own instruction — cross-document browse UI, not an editor capability. |
| `comment-store.ts`, `comment-anchoring.ts`, `comment-model.ts`, `renderer/comments/**`, `renderer/stores/comment*Store.ts` | Persistence, identity, lifecycle (resolve/reopen) and panel UX. FR-005 forbids all of it in the package. |

The same rule applies symmetrically to Liminis: its correction store, and the
accept/reject lifecycle, stay app-side too.

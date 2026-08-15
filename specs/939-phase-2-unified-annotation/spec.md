# Feature Specification: Phase 2 — Unified annotation mechanism in `@liminis/editor`

**Feature Branch**: `fabrik/issue-939`
**Created**: 2026-08-04
**Status**: Amended during implementation (see "Amendments" below)
**Input**: User description: "Phase 2 — Unified annotation mechanism in `@liminis/editor`: corrections and comments as two kinds. Blocked by #938 (Phase 1: carve `packages/editor` and have `liminis-app` consume it at parity). This issue introduces the unified annotation mechanism and re-expresses both corrections and comments as usages of it."

## Background

Comments and corrections are the same shape — a range-anchored annotation over document text,
surfaced with in-document markers plus affordances, with data flowing in and events flowing out:

- **Liminis** has an AI **correction** feature (`CorrectionPanelPlugin`, `AmbientCorrectionPlugin`,
  `SelectionContextMenuPlugin`, `correction-yaml.ts`), which moved into `packages/editor` in Phase 1
  and is still bespoke there.
- **Zusammen** (`verveguy/zusammen`) has a review **commenting** feature — durable, text-anchored
  comments rendered as live `@lexical/mark` MarkNodes, transparent on export. This is the most
  mature realization of the mechanism; **port from it**, then generalize so corrections fit.

Two near-identical editor trees have been diverging: Zusammen accreted commenting, Liminis accreted
corrections. Phase 1 (#938) stopped the divergence for the *core* by making the editor one package
with a curated public surface and a persistence-drawn seam (ADR-075). It deliberately left the two
annotation-shaped features unreconciled. Without Phase 2, the package would ship a correction-only
mark/anchor code path and Zusammen could not adopt the package without forking it back — the exact
failure Phase 1 set out to end.

Rather than build an editor each host *extends* through a general-purpose plugin API (a risky,
hard-to-stabilize design), this phase bakes a single **annotation mechanism** into the package and
expresses comments and corrections as **two configured usages of it**.

### The boundary: in-package vs. in-app

The seam is **persistence**, consistent with ADR-075. The package owns the annotation *mechanics*;
each consuming app owns storage, lifecycle, identity, and higher-level UX.

**In the package**: the durable anchor model, selection→anchor capture, the fuzzy anchor
**resolver** (classify against a changed document: unchanged / re-attached / flagged / orphaned),
MarkNode marker rendering, mark-transparency on export, the live-mark placement policy, and
in-document affordances (create-on-selection, marker click → activate, scroll-to).

**In the app**: persistence (Zusammen's comment WAL on `refs/zusammen/comments`; Liminis's
correction store), annotation **lifecycle** (comments: resolve/reopen; corrections: accept/reject),
actor/identity, the semantic-relocation strategy the resolver calls out to, and the higher-level
panels (thread panel, cross-document browse; correction panel).

### Unified mechanism — one primitive, two usages

An **annotation** is `{ id, kind, anchor, presentation?, payload? }`, where `anchor` is the durable
pointer (target text + structural context + document version) the resolver can re-find. The package
supports both **host-injected** annotations and **user-initiated** creation, configured **per kind**.

Illustrative sketch — the Plan stage owns the final shape:

```ts
// data IN
annotations: Annotation[]                  // markers to render (comments + corrections)
annotationKinds: Record<Kind, {
  markerStyle: ...                         // comment = highlight+count; correction = squiggle+severity
  createAffordance?: { label, icon } | null// user-initiated create (comments) vs injected-only (corrections)
  livemarkPolicy: (a: Annotation) => bool  // comments: only unchanged/re-attached (shouldPlaceLiveMark)
  inlineActions?: (a) => ReactNode | null  // corrections: accept/reject inline; comments: activate-only
}>
scrollToAnnotation?: { id, nonce } | null
// events OUT
onCreateAnnotation(kind, anchor, draft?)   // user created one (comments)
onActivateAnnotation(id)                   // marker clicked (host opens its own panel/thread)
// headless exports the host can call directly (tied to its persistence / doc versions):
captureAnchor(text, range, docVersion) -> Anchor
resolveAnchors(anchors, documentText, opts) -> Array<{ id, outcome, resolvedAnchor? }>
```

- **Comments** = a `comment` kind: user-created (create affordance on), live mark only for
  unchanged/re-attached anchors, activate-only (host opens its thread panel).
- **Corrections** = a `correction` kind. *As amended:* Liminis corrections have never had
  in-document markers, so the kind is configured `markerStyle: 'none'` / `livemarkPolicy: () => false`
  and its authoring entry point is the existing "Correction…" context-menu item. Accept/reject stays
  in the app's correction panel, exactly where it is today. Liminis persists to / sources from the
  correction store + context graph.

### Two mechanisms that must not be conflated

Liminis corrections are discovered today by a **term-substitution scan** (`AmbientCorrectionPlugin`
walks prose text and finds word-boundary occurrences of a term, preserving capitalisation). That is
*candidate discovery*, and it is exact word matching, not fuzzy anchor re-resolution. The anchor
resolver's fuzzy matching answers a different question: *given an anchor captured against an older
document version, where is that range now?*

This spec keeps them distinct: term-scan discovery produces candidate ranges which become
`correction` annotations with captured anchors; anchor **re-resolution** is the unified resolver's
job. FR-003's "fuzzy text matching occurs in exactly one module" constrains the resolver, not the
correction term scan.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Corrections are a usage of the annotation mechanism (Priority: P1)

A Liminis user works in a document where the AI has proposed corrections. Corrections are expressed
as annotations of `kind: 'correction'`, sharing the anchor model and the one marker renderer with
comments — but *as amended*, the kind configures that renderer off, because Liminis corrections
never had markers and giving them any would be a visible change. Nothing about the experience
changes.

**Why this priority**: This is the requirement that proves the mechanism is genuinely unified rather
than a comment feature bolted alongside a correction feature. It is also the requirement that
carries user-visible regression risk, so it must be provable.

**Independent Test**: Run the existing correction test suites plus the app-level correction flows
against the refactored package; verify no correction-only mark, anchor, or resolution code path
remains by inspecting the package's module graph.

**Acceptance Scenarios**:

1. **Given** a document with AI-proposed corrections, **When** the user opens it, **Then** the
   corrections appear, read, and behave exactly as they did before this change.
2. **Given** a proposed correction, **When** the user accepts or rejects it inline, **Then** the
   outcome is identical to the pre-change behaviour, and the accept/reject decision is handled by
   `liminis-app`, not by the package.
3. **Given** the package source, **When** searching for mark/anchor/resolution code, **Then** exactly
   one anchor model, one resolver, and one marker renderer exist, with no `correction`-specific
   variant of any of the three.

---

### User Story 2 - Comments are a usage of the annotation mechanism (Priority: P1)

The package ships commenting as `kind: 'comment'`: create-on-selection, live marks for
unchanged/re-attached anchors, activate-to-open, mark-transparent export. A host enables it by
supplying persistence and a panel — no editor changes. `liminis-app` leaves comments **disabled**;
this introduces no new Liminis product feature.

**Why this priority**: Comments are the mature realization being ported and are the reason the
mechanism exists. Without them the "unified" claim is untested against a second usage.

**Independent Test**: Package-level tests exercise create-on-selection, marker rendering,
activation, live-mark placement, and export transparency against a test host that provides
in-memory persistence — no `liminis-app` involvement.

**Acceptance Scenarios**:

1. **Given** a selection in the editor and the `comment` kind enabled, **When** the user invokes the
   create affordance, **Then** `onCreateAnnotation('comment', anchor)` fires with a captured anchor
   and no persistence occurs inside the package.
2. **Given** a comment anchored to text, **When** the document is edited around it, **Then**
   re-resolution classifies the anchor as unchanged / re-attached / flagged / orphaned matching
   Zusammen's currently-tested behaviour case-for-case.
3. **Given** an anchor classified unchanged or re-attached, **When** markers are placed, **Then** a
   live MarkNode is placed; **Given** flagged or orphaned, **Then** no live mark is placed.
4. **Given** a document containing live marks, **When** it is exported to markdown, **Then** the
   output is byte-identical to the same document without marks.
5. **Given** `liminis-app` after this change, **When** a user works in any document, **Then** no
   commenting UI or affordance is present.

---

### User Story 3 - Zusammen's needs are met by the public API (Priority: P2)

Every editor-domain capability Zusammen's editor copy and its `app/src/shared/anchor-*` modules
provide today is reachable from the package's declared export subpaths, including headless
`captureAnchor` / `resolveAnchors` callable outside a rendered editor.

**Why this priority**: Zusammen's actual adoption is a follow-up in that repo, but if the public API
has a gap, adoption forces a fork or a deep import — which is the failure mode Phase 1 and ADR-075
exist to prevent. Proving the mapping now is cheap; discovering the gap later is not.

**Independent Test**: A committed capability-by-capability mapping document, checkable by reading it
against the package's declared exports without running Zusammen.

**Acceptance Scenarios**:

1. **Given** the manifest of Zusammen editor-domain capabilities, **When** each is traced to a
   package export, **Then** every entry resolves to a symbol reachable from a declared subpath.
2. **Given** the mapping, **When** an entry cannot be satisfied, **Then** it is recorded explicitly
   as a known gap with a rationale, rather than silently omitted.
3. **Given** the resolver's semantic-relocation seam, **When** a host supplies no strategy, **Then**
   resolution still completes and yields `orphaned` rather than erroring.

---

### Edge Cases

- Anchored range deleted entirely → `orphaned`; no live mark; host decides what to show.
- Anchored text appears multiple times after an edit → structural context disambiguates, or the
  anchor is `flagged` rather than silently re-attached to the wrong occurrence.
- Overlapping / nested annotations of different kinds over the same text → marker rendering and
  export transparency both remain correct.
- Annotation anchored inside a specially-mapped construct (code block, table cell, footnote,
  frontmatter, C4/Mermaid diagram) → works or degrades to `orphaned`; never corrupts the round-trip.
- Host supplies an annotation whose `kind` has no configuration → ignored with a logged warning via
  the injected logger, no crash.
- `scrollToAnnotation` targets an orphaned or unknown annotation → no-op, not an error.
- Both kinds enabled in one document → both render; activation routes to the correct host handler.
- A correction's term scan finds occurrences inside a code block or frontmatter → excluded, as today.
- Anchor resolution is asynchronous (the semantic-relocation seam may be host-supplied and slow) →
  a document edited again mid-resolution must not apply stale marker placements.
- The editor unmounts while a create's deferred anchor read is still pending (document swapped, host
  panel closed) → the read is cancelled; no host callback fires and no torn-down editor is touched.
- Annotation anchored inside a wiki-link's alias (including a plain `[text](page.md)` link, which is
  promoted to wiki-link syntax on export) → the alias carries the annotate-mode sentinel tokens, so
  capture works. An **unaliased** wiki-link (`[[the quick brown fox]]`) has nowhere to put them
  without inventing an alias, which would change the document's structure in annotate mode and break
  the byte-identity the capture offset math depends on — so capture declines there, the same safe
  fallback every unlocatable anchor takes.
- A user invokes a `contextMenu`-surfaced create affordance → the menu overlay must not collapse the
  selection it acts on. Mousedown inside the menu is default-prevented so focus never leaves the
  contenteditable before the click handler reads the native selection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Comments and corrections MUST both be expressed as *kinds* of one annotation
  mechanism. The package MUST NOT contain a feature-specific mark, anchor, or anchor-resolution code
  path for either kind; kinds MUST differ only by configuration data passed to the mechanism.
- **FR-002**: The package MUST expose the annotation mechanism through its declared export subpaths
  (ADR-075's closed-export rule continues to hold; adding a considered export is allowed, a deep
  import is not — *as amended*, `./annotations` is that considered addition, and ADR-075's own
  export inventory records it as the sixth). The surface MUST include the data-in/events-out props
  and headless `captureAnchor` / `resolveAnchors` that are callable outside a rendered editor and
  free of DOM and Lexical dependencies.
- **FR-003**: The anchor resolver's classification outcomes (`unchanged` / `re-attached` / `flagged`
  / `orphaned`), their thresholds, and mark-transparency-on-export MUST be preserved as ported from
  Zusammen, with Zusammen's existing tests for those modules carried over into the package. Fuzzy
  text matching for anchor re-resolution MUST occur in exactly one module.
- **FR-004**: The annotation mechanism MUST be opt-in and off by default. A consumer configuring no
  kinds MUST render no annotation UI, register no annotation commands, and MUST NOT pull the
  annotation *feature* modules into its import graph. *As amended:* `MarkNode` registration and the
  mapper's mark-transparency are unconditional — the mapper is shared and cannot be made kind-aware
  without forking the round-trip path, which is the divergence Phase 1 ended, and `MarkNode` is an
  inert node with no behaviour when nothing places one. The measurable form of this requirement is
  SC-004's import-graph assertion over `src/annotations/**` and the annotation plugins.
- **FR-005**: The package MUST NOT contain persistence, actor/identity, or annotation-lifecycle
  logic. Comment storage, correction storage, resolve/reopen, accept/reject, and the semantic
  relocation strategy stay in the consuming apps, reached only via injected services or callbacks.
- **FR-006**: Correction behaviour in `liminis-app` MUST be at parity — no user-visible change to
  what is proposed, how it is presented, or what accept/reject does. Existing correction tests MUST
  pass unmodified except where a test asserts on an internal symbol that this refactor renames.
- **FR-007**: `liminis-app` MUST ship with the `comment` kind disabled; no commenting affordance,
  marker, or menu entry may be reachable by a Liminis user after this change.
- **FR-008**: A capability mapping from Zusammen's editor-domain modules (its editor-copy plugins and
  `app/src/shared/anchor-model.ts`, `anchor-resolver.ts`, `block-structure.ts`,
  `comment-anchor-align.ts`, `comment-editor-handle.ts`, and the editor-domain parts of
  `comment-thread.ts`) to package exports MUST be committed as a document in the repository, with
  any unmet capability recorded explicitly as a known gap.
- **FR-009**: The unified annotation primitive and its persistence seam MUST be recorded as an ADR in
  `docs/project_notes/decisions/`, cross-referenced from ADR-075 and listed in `index.md`.
- **FR-010**: The package MUST continue to satisfy Phase 1's constraints: no direct import of host
  globals (`window.api`, `messaging-electron`, `sonner`, `shared/logger`), and full
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test` success across the workspace.

### Key Entities

- **Annotation**: `{ id, kind, anchor, presentation?, payload? }` — a range-anchored marker over
  document text. Identity and payload semantics belong to the host; the package treats `id` as
  opaque and `payload` as pass-through.
- **Anchor**: the durable pointer — target text, surrounding structural context, and the document
  version it was captured against. Serializable; the host persists it.
- **AnnotationKind configuration**: per-kind marker style, create affordance (or none), live-mark
  placement policy, and inline actions. The only thing distinguishing a comment from a correction.
- **AnchorResolution**: `{ outcome, reason, resolvedAnchor? }` where outcome ∈ `unchanged` |
  `re-attached` | `flagged` | `orphaned`.
- **SemanticRelocation seam**: an optional host-supplied strategy the resolver consults before
  declaring an anchor orphaned. Absent by default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Corrections and comments demonstrably use one anchor model, one resolver, and one
  marker renderer; a reviewer can point at exactly one module for each of the three, and at the
  kind-configuration objects as the sole difference between the two features — including the fact
  that the `correction` kind's configuration is what turns the marker renderer off for it, and that
  corrections do not exercise the resolver at all (they have no durable anchors).
- **SC-002**: Anchor re-resolution matches Zusammen's currently-tested behaviour case-for-case —
  every assertion in Zusammen's `anchor-model`, `anchor-resolver`, `block-structure`,
  `comment-anchor-align`, and editor-domain `comment-thread` tests passes in the package.
- **SC-003**: Mark-transparency on export holds: a document with live marks exports byte-identically
  to the same document without them, asserted by test over the existing round-trip fixture corpus.
- **SC-004**: A consumer with annotations disabled ships no annotation UI, and the annotation modules
  are not reachable in its module graph — verified by a static import-graph assertion (the package is
  consumed as source, so this is checked at the import graph, not a bundle byte count).
- **SC-005**: `liminis-app` builds, tests, and behaves exactly as before; comments remain disabled
  there and correction flows are unchanged end to end.
- **SC-006**: The Zusammen capability mapping shows zero unmet capabilities, or each unmet one is
  recorded with a rationale and a follow-up.

## Amendments

Recorded during Research/Plan/Implement and ratified in ADR-077. The original text above has been
updated in place; this section states what changed and why, so the spec is not silently rewritten to
match whatever was built.

1. **Corrections render no in-document marker and gain no inline accept/reject.** The original text
   described corrections as "always live while active" with "inline accept/reject". Research found
   that Liminis corrections have no marks, no anchors, no resolution and no inline actions today —
   the feature is a context-menu entry plus a panel. Under a literal reading, FR-001 (corrections
   must use the one marker renderer) and FR-006 (no user-visible correction change) could not both
   hold. Resolved in favour of FR-006: the `correction` kind configures the marker renderer off.
   FR-001's substantive guarantee — no correction-specific mark, anchor or resolution code path in
   the package — is unaffected and is what SC-001 is checked against.

2. **Corrections do not exercise the resolver.** Already stated in the Assumptions below; restated
   in SC-001 because a reviewer looking for "one resolver, shared" would otherwise expect to find a
   correction consumer of it. There is none — the resolver exists for Zusammen (US3) and the ported
   tests.

3. **`MarkNode` registration and mapper mark-transparency are unconditional** (FR-004). Both are
   shared, inert-when-unused infrastructure; making the mapper kind-aware would fork the round-trip
   path. FR-004 is therefore measured at the import graph, per SC-004, not at node registration.

4. **In `liminis-app` the correction create-command dispatch is currently inert.** The package's
   create handler mounts only when a host supplies `onCreateAnnotation`, and Liminis deliberately
   does not: corrections have no durable anchors, so there is nothing to do with a captured one, and
   running a wrap/read/unwrap cycle to discard the result would be cost and FR-006 risk on a
   user-visible path. The wiring is present and one callback away from live. See ADR-077.

5. **There is exactly one selection→anchor capture path, and it is `AnnotationPlugin`.** An earlier
   iteration also exported a `captureAnchorFieldsFromSelection` helper documented as "the shared
   primitive both kinds use". It had no production caller, and it read the anchor synchronously
   right after wrapping — which would have returned `null` every time from inside a command handler,
   the exact failure `AnnotationPlugin`'s microtask deferral exists to prevent. It was removed
   rather than made async: a second "shared primitive" that nothing shares is a trap regardless of
   whether it is correct.

6. **The ADR is numbered 077, not 076.** It was authored as ADR-076, but #943 landed its own
   ADR-076 (markdown serialization as a fixed point) on `main` while this branch was open. On the
   rebase, `main`'s ADR-076 is kept untouched and this branch's ADR moved to `adr-077.md`, with
   every reference following it. FR-009's substance is unchanged — the ADR exists, cross-references
   ADR-075, and is listed in `index.md`; only the number moved.

## Assumptions

- Phase 1 (#938) has merged; `packages/editor` exists on `main` with the ADR-075 seam, five declared
  export subpaths, and `liminis-app` consuming it at parity. This work builds directly on that.
- The Zusammen source is read from the local checkout at `~/dev/zusammen` on the Fabrik host. The
  issue's `shared/...` paths are actually `app/src/shared/...`; the editor plugin paths under
  `app/src/editor/app/editor/` are correct as written. No `gh` clone or network access to the
  Zusammen repo is needed or assumed.
- "Fuzzy matching in exactly one module" (FR-003) scopes to **anchor re-resolution**. The
  correction feature's term-substitution scan is exact word-boundary matching for *candidate
  discovery* and is a legitimately separate concern; it is not folded into the resolver.
- `SelectionContextMenuPlugin`'s "Correction…" entry is a correction *authoring* entry point routed
  to the host. Whether it is re-expressed via the generic create-affordance mechanism or left as-is
  is a Plan-stage decision; either way FR-006 parity binds the user-visible result.
- Corrections do not gain durable cross-session anchors from this change. They adopt the anchor model
  and resolver as the mechanism, but their lifetime and storage remain what they are today
  (correction store, app-side) — this is a refactor, not a data-model change for corrections.
- US2 is validated by package-level tests against a test host with in-memory persistence, plus the
  ported Zusammen tests. It is not validated by shipping a Liminis comment feature.
- The resolver is asynchronous because of the semantic-relocation seam; the package's public
  `resolveAnchors` is therefore async, and hosts are expected to handle that.
- `zod` is already a package dependency, so porting the schema-carrying anchor modules adds no new
  runtime dependency.
- No persisted comment or correction data exists to migrate in Liminis.

## Out of Scope

- Zusammen's actual adoption of the package and deletion of its editor copy — a follow-up in the
  Zusammen repository. This phase only proves the API can serve it.
- OSS hardening — standalone build, peer dependencies, wiki-link patch resolution, license, docs,
  demo. That is Phase 3 (#940).
- Enabling commenting as a Liminis product feature: comment storage, actor/identity, thread panel,
  cross-document browse. The package ships the mechanism; Liminis does not turn it on.
- Migrating persisted comment or correction data; changing comment or correction *product*
  behaviour.
- Pulling up Zusammen's markdown round-trip idempotency fixes (its #62 work) — a separate issue,
  flagged in #938 so it is not lost.
- A general-purpose third-party plugin API. The annotation mechanism is a baked-in feature with
  per-kind configuration, deliberately not an extension point.
- `liminis-mobile` and `liminis-viewer`.

## Deferred to follow-up

- **`collectLiveAnchorSnapshots` performance.** It runs one full Markdown serialization per
  annotation id (review finding, CodeRabbit), so a 50-annotation document performs 50 complete
  serializations inside one read. It is a checkpoint-time path with no Liminis consumer — Liminis
  places no live marks — and fixing it properly means redesigning the sentinel protocol to bracket
  every id in a single annotate pass. Belongs with the Zusammen adoption work, where it first
  matters.
- **Resolver algorithm refinements** raised in review and deliberately not taken here, because
  FR-003 requires the ported classification be preserved and SC-002 asserts Zusammen's tests pass
  case-for-case: a structural block-type check on the fuzzy re-attach path, local-range (rather than
  whole-block/sentence) fuzzy candidates, and a discriminated-union `ANCHOR_RESOLUTION_SCHEMA` that
  ties `anchor` presence to the `re-attached` outcome. Each would diverge the package from the
  codebase it must serve; they belong upstream in Zusammen or in a change that moves both together.
- **Capture inside an unaliased wiki-link.** An annotation anchored inside `[[the quick brown fox]]`
  cannot be captured: wiki-link syntax has no alias slot to carry the annotate-mode sentinel tokens,
  and emitting one to make room would change the annotated export's structure and break the
  byte-identity `locateLiveMarkdownRange`'s offset math depends on. Capture declines instead — the
  same safe fallback every unlocatable anchor takes, pinned by a test so it cannot drift into a
  silent mis-capture. Aliased wiki-links, including plain `[text](page.md)` links promoted to
  wiki-link syntax, do capture correctly. Closing this properly means a sentinel representation that
  does not depend on an alias slot; it belongs with the Zusammen adoption work, where live marks
  first exist.

## Source References

- Prior phases: #938 (Phase 1 — package carve-out, merged), #940 (Phase 3 — OSS hardening).
- ADR-075 — `docs/project_notes/decisions/adr-075.md`, "The `@liminis/editor` Package Boundary Is
  Drawn at Persistence".
- ADR-077 — `docs/project_notes/decisions/adr-077.md`, the unified annotation primitive and its
  persistence seam.
- ADR-057 — Knowledge Corrections file format and pipeline.
- Liminis correction code (post-#938, in-package): `packages/editor/src/app/editor/`
  `CorrectionPanelPlugin.tsx`, `AmbientCorrectionPlugin.tsx`, `SelectionContextMenuPlugin.tsx`,
  `correction-yaml.ts`; app-side store `liminis-app/src/renderer/stores/correctionStore.ts`.
- Zusammen annotation mechanics to port (paths relative to `~/dev/zusammen/`):
  - `app/src/editor/app/editor/CommentSelectionPlugin.tsx` — selection → create + anchor capture
  - `app/src/editor/app/editor/CommentMarkerPlugin.tsx` — render markers, scroll/pulse, activate
  - `app/src/editor/app/editor/comment-anchor-marks.ts` — MarkNode placement + capture primitive
  - `app/src/editor/app/editor/commentCommands.ts` — editor commands
  - `app/src/editor/app/editor/Editor.tsx` — `CommentEditorHandlePlugin`, `shouldPlaceLiveMark` gate
  - `app/src/editor/app/mapper/lexicalToMdast.ts` — `effectiveChildren` mark-transparency and the
    `setAnnotateTarget` / `collectMarksWithId` annotated-export path
  - `app/src/shared/anchor-model.ts` (`Anchor`, `AnchorFields`, `captureAnchor`, `AnchorOutcome`),
    `anchor-resolver.ts` (the sole fuzzy-matching module), `block-structure.ts`,
    `comment-anchor-align.ts` (`locateInSpan`), `comment-editor-handle.ts`, and the editor-domain
    parts of `comment-thread.ts` (`MarkerTarget`, `shouldPlaceLiveMark`, `deriveMarkerTargets`) —
    but **not** `deriveWorkspaceCommentList` (app-domain)
  - Tests to carry over: `app/src/shared/anchor-model.test.ts`, `anchor-resolver.test.ts`,
    `block-structure.test.ts`, `comment-anchor-align.test.ts`, `comment-thread.test.ts`
  - Design ADRs: `adrs/008-comment-anchor-resolution.md`, `adrs/012-comment-anchor-as-live-mark.md`
    (and `adrs/003`, `adrs/005` for the persistence side that stays app-side)
- Explicitly **not** moved into the package (app-domain persistence/UX): Zusammen's
  `app/src/main/comment-store.ts`, `comment-anchoring.ts`, `comment-model.ts`,
  `renderer/comments/**`, `renderer/stores/comment*Store.ts`; Liminis's
  `renderer/stores/correctionStore.ts`.

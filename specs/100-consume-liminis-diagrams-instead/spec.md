# Feature Specification: Consume `@liminis/diagrams` Instead of the Local C4 Copy

**Feature Branch**: `fabrik/issue-100`
**Created**: 2026-08-22
**Status**: Specified
**Input**: User description: "`src/app/editor/c4/` was extracted to https://github.com/verveguy/liminis-diagrams and published as `@liminis/diagrams`. This repo still carries the original copy, so the same parser and layout engine now exist in two places and can diverge. Replace the local C4 subsystem with the published package."

## Background

`src/app/editor/c4/` holds this package's C4 diagram subsystem: a markdown-fence
parser, a layout engine, and rendering helpers (React and server-side SVG). That
code was extracted verbatim into its own repository,
[`liminis-diagrams`](https://github.com/verveguy/liminis-diagrams), and published
to npm as `@liminis/diagrams`. Since the extraction, this repository has kept its
own copy of the same source rather than depending on the package, so the parser
and layout engine now exist in two places that can silently drift apart —
identical bugs get fixed twice, or fixed in only one.

This issue retires the local copy in favor of the published dependency, so there
is exactly one implementation of C4 parsing and layout. The extraction was
deliberately partial: `liminis-diagrams` took the parse-and-layout engine and a
subset of tests, but not the markdown round-trip tests in
`src/app/editor/c4/integration.test.ts`, because those tests exercise this
package's own concern — the ```` ```c4 ```` fence's `@layout` meta-string
contract — which the extracted package never sees (it receives fence *contents*,
not the fence itself). Those tests, along with the file's slash-menu test, must
survive the migration with no other home to move to.

The publish itself was tracked as a blocking dependency
(verveguy/liminis-diagrams#3); it closed on 2026-08-23 with `@liminis/diagrams`
`0.1.0` published to npm, so this work is now unblocked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single source of truth for C4 parsing and layout (Priority: P1)

As a maintainer of this repository, I want C4 diagram parsing and layout to come
from the published `@liminis/diagrams` package rather than a local copy, so that
fixes and improvements to the parser or layout engine only need to happen once
and cannot silently diverge between the two repositories.

**Why this priority**: This is the entire purpose of the issue — without it,
the duplication this issue exists to remove is unchanged.

**Independent Test**: `src/app/editor/c4/` no longer exists (except for the
relocated test file's prior content), `@liminis/diagrams` appears as a
dependency in `package.json`, and every former import of local C4 modules
resolves to the package instead.

**Acceptance Scenarios**:

1. **Given** the repository after this change, **When** searching the source
   tree for imports of `./c4/…` or `../c4/…` (or any path containing
   `editor/c4/`), **Then** no such import remains.
2. **Given** `package.json`, **When** inspecting its dependencies, **Then**
   `@liminis/diagrams` is listed and the local `c4/` implementation is gone.

---

### User Story 2 - The markdown `@layout` round-trip contract stays covered (Priority: P1)

As a maintainer, I want the existing markdown round-trip tests for the C4
fence's `@layout` meta-string contract (hand-dragged element positions
persisted through `parseMarkdown`/`stringifyMarkdown`) to keep running after
the migration, so that this repository-specific contract — which the extracted
package cannot exercise itself — does not silently lose its only end-to-end
guard.

**Why this priority**: The issue explicitly warns that deleting this coverage
is not a refactor detail but a loss of the only test protecting a real user
capability (diagrams keep their hand-placed layout across edits/save-reload).

**Independent Test**: Run the relocated test file in isolation and confirm the
markdown round-trip assertions and the slash-menu test both execute and pass,
using `parseC4`/`layoutC4Diagram` imported from `@liminis/diagrams` rather than
from a local module.

**Acceptance Scenarios**:

1. **Given** `src/app/editor/c4/integration.test.ts` before this change,
   **When** the migration completes, **Then** an equivalent test file exists
   at a new location outside any `c4/` directory, importing `parseC4` and
   `layoutC4Diagram` from `@liminis/diagrams` instead of a relative path.
2. **Given** the relocated test file, **When** the test suite runs, **Then**
   the markdown round-trip tests and the slash-menu test all pass.

---

### User Story 3 - Downstream consumers see no change in the public API (Priority: P1)

As a consumer of `@liminis/editor` (via `index.ts` or `headless.ts`), I want
the set of exported names to be exactly what it was before this change, so
that this internal refactor requires no changes on my side and no major
version bump.

**Why this priority**: The issue is explicit that an export-surface change is
a bug in this work, not an accepted side effect — this is what keeps the
change a patch/internal change rather than a breaking one.

**Independent Test**: Diff the export lists of `src/index.ts` and
`src/headless.ts` before and after the change; the diff should show only
changed *source paths* (local `./app/editor/c4/...` → `@liminis/diagrams/...`
re-exports), never changed or removed *names*.

**Acceptance Scenarios**:

1. **Given** the list of names exported from `src/headless.ts` before this
   change, **When** compared to the list after, **Then** the two lists are
   identical.
2. **Given** the list of names exported from `src/index.ts` before this
   change, **When** compared to the list after, **Then** the two lists are
   identical.

---

### User Story 4 - C4 diagrams keep working in the running editor (Priority: P2)

As an editor user, I want C4 diagrams to continue rendering and to remain
draggable (manual layout persists) after this internal migration, so that a
dependency-source change is invisible to me.

**Why this priority**: Automated tests cover parsing, layout, and the
round-trip contract, but the issue calls out that actual rendering and drag
interaction in the running app must be verified directly, not inferred from
tests alone.

**Independent Test**: Run the editor locally, insert or open a document
containing a ```` ```c4 ```` fence, confirm the diagram renders, drag an
element to a new position, save/reload (or otherwise trigger a round-trip),
and confirm the dragged position persisted.

**Acceptance Scenarios**:

1. **Given** the running editor with a document containing a C4 diagram,
   **When** the document is opened, **Then** the diagram renders identically
   to before this change.
2. **Given** a rendered C4 diagram, **When** an element is dragged to a new
   position, **Then** the new position is reflected immediately and survives
   a save/reload round-trip.

---

### Edge Cases

- The `ManualLayout` type is consumed by `src/app/mapper/mdastToLexical.ts`
  (in `extractC4LayoutFromMeta`) via an inline `import(...)` type reference
  into the local `c4/types` module; this must be repointed to
  `@liminis/diagrams/core` without changing the function's behavior.
- `src/ambient/jsx.d.ts` is a shim that other code depends on and must not be
  touched by this migration, even though it sits near the C4/Lexical code
  being edited.
- The Lexical glue components (`C4Node.tsx`, `C4Component.tsx`) must change
  only their import statements — no other line in those files should change,
  since that layer is editor-specific and intentionally stays local.
- `integration.test.ts`'s new location must not itself be inside a directory
  named `c4/`, since the whole point of relocating it is that it is no longer
  part of that subsystem's local source tree.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `@liminis/diagrams` MUST be added as a dependency of this
  package.
- **FR-002**: `src/app/editor/c4/` MUST be deleted in its entirety except for
  the content of `integration.test.ts`, which MUST be preserved (relocated,
  not deleted).
- **FR-003**: `src/app/editor/nodes/C4Component.tsx` MUST import its C4
  parsing/layout/rendering functionality from `@liminis/diagrams/core` and
  `@liminis/diagrams/react` instead of the local `../c4/...` modules, with no
  other change to the file's behavior.
- **FR-004**: `src/app/editor/nodes/C4Node.tsx` MUST import the `ManualLayout`
  type from `@liminis/diagrams/core` instead of the local `../c4/types`
  module, with no other change to the file's behavior.
- **FR-005**: `src/app/mapper/mdastToLexical.ts` MUST reference the
  `ManualLayout` type (in `extractC4LayoutFromMeta`) from
  `@liminis/diagrams/core` instead of the local `../editor/c4/types` module.
- **FR-006**: `src/index.ts` MUST re-export the same C4-related names it
  exported before this change, sourced from `@liminis/diagrams` instead of
  local `./app/editor/c4/...` modules.
- **FR-007**: `src/headless.ts` MUST re-export the same C4-related names it
  exported before this change (`renderC4DiagramToSVG`, `parseC4`,
  `validateC4`, `layoutC4Diagram`, the `isSystem`/`isContainer`/`isComponent`/
  `isPerson`/`isExternal`/`isBoundary` type guards, and all listed C4 types
  including `ManualLayout`), sourced from `@liminis/diagrams` instead of local
  `./app/editor/c4/...` modules.
- **FR-008**: `integration.test.ts` MUST be moved out of any `c4/`-named
  directory to a location appropriate to its new scope (markdown round-trip
  and slash-menu tests, no longer bundled with a parser/layout
  implementation), with its `parseC4`/`layoutC4Diagram` imports repointed at
  `@liminis/diagrams`.
- **FR-009**: The markdown round-trip tests (`parseMarkdown`/
  `stringifyMarkdown` against the `@layout` fence-meta contract) and the
  slash-menu test currently in `integration.test.ts` MUST continue to exist
  and pass after relocation.
- **FR-010**: No behavior change to C4 parsing, layout, or rendering is
  in scope — this is a source-of-implementation change only.
- **FR-011**: `src/ambient/jsx.d.ts` MUST NOT be modified by this change.

### Key Entities

- **`ManualLayout`**: a type describing hand-dragged element positions for a
  C4 diagram; persisted through the ```` ```c4 ```` fence's `@layout`
  meta-string and consumed by both the Lexical node layer and the mdast
  mapper. Its defining module moves from local `c4/types` to
  `@liminis/diagrams/core`, but its shape and meaning are unchanged.
- **C4 fence meta-string contract**: the mechanism by which a
  ```` ```c4 ```` markdown code fence's meta string carries a JSON blob of
  manually-dragged layout positions across `parseMarkdown`/`stringifyMarkdown`
  round-trips. This repository owns this contract; `@liminis/diagrams` only
  ever sees fence contents, never the fence itself, so it cannot test this
  contract — `integration.test.ts` is this contract's only guard and must
  survive the migration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `src/app/editor/c4/` does not exist after this change.
- **SC-002**: `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` all
  pass.
- **SC-003**: The markdown round-trip tests and the slash-menu test
  (relocated from `integration.test.ts`) exist, run, and pass.
- **SC-004**: The export lists of `src/headless.ts` and `src/index.ts` are
  identical before and after the change (same names; only source paths
  differ). This diff is stated explicitly in the PR description.
- **SC-005**: C4 diagrams render and remain draggable (manual layout
  persists) when manually verified in the running editor.

## Assumptions

- `@liminis/diagrams` `0.1.0` is published to npm and installable
  (verveguy/liminis-diagrams#3 closed 2026-08-23); the earlier block on this
  issue no longer applies.
- The exact dependency version range/constraint for `@liminis/diagrams` in
  `package.json`, and the precise new location/filename for the relocated
  `integration.test.ts`, are implementation details for the Research/Plan
  stages to resolve, not product decisions requiring sign-off here.
- This change is internal/non-breaking for consumers of this package (per
  User Story 3), so per this repository's release convention it lands as a
  patch-level or otherwise non-breaking entry — most likely folded into the
  existing `## Unreleased` section of `CHANGELOG.md` (which already holds
  unreleased changes from #98 against the still-unreleased `0.3.0`) — rather
  than forcing a version bump. Confirming the exact CHANGELOG/version
  treatment is left to Plan/Implement.
- `liminis-diagrams/docs/EXTRACTION-PLAN.md` §4 and §5 (in the separate
  `liminis-diagrams` repository) contain additional detail on what was
  extracted and how; the Research stage is expected to consult it.

## Out of Scope

- Any behavior change to C4 parsing, layout, or rendering.
- Changes to the Lexical glue (`C4Node.tsx` / `C4Component.tsx`) beyond their
  import lines — that layer is editor-specific and stays in this repository
  by design.
- The `src/ambient/jsx.d.ts` shim.
- Any work inside the `liminis-diagrams` repository itself (already complete
  and published).

## Source References

- `src/app/editor/c4/` (to be deleted, except `integration.test.ts`'s
  content, which relocates).
- `src/app/editor/nodes/C4Component.tsx`, `src/app/editor/nodes/C4Node.tsx`,
  `src/app/mapper/mdastToLexical.ts`, `src/index.ts`, `src/headless.ts` (the
  five import sites to rewrite).
- `liminis-diagrams/docs/EXTRACTION-PLAN.md` §4 and §5 (external repo).
- verveguy/liminis-diagrams#3 (publish blocker, closed).

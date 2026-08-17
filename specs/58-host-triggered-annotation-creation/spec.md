# Feature Specification: Host-triggered annotation creation, affordance icon, and selection-context-menu no-op-when-unconfigured

**Feature Branch**: `fabrik/issue-58`
**Created**: 2026-08-17
**Status**: Specified
**Input**: User description: "`verveguy/zusammen` issue #117 ('Comment-on-selection: add \"Add Comment\" to the context menu and fix the floating toolbar comment icon') needs three related additions to `@liminis/editor`'s annotation system. All three touch the same small set of files, so they're filed together to land in one version bump. See the three numbered sub-requirements below."

## Background

`@liminis/editor` already has a full annotation-creation pipeline (ADR-077):
`AnnotationPlugin` listens for `OPEN_ANNOTATION_COMPOSER_COMMAND` and, on
receiving `{ kind }`, reads `window.getSelection()` live, captures an anchor,
wraps it in a transient mark, and hands the result to the host's
`onCreateAnnotation`. Today the only two callers of that dispatch are
components that live *inside* the `LexicalComposer` tree and hold the Lexical
`editor` via `useLexicalComposerContext`: the package's own `Toolbar`
(`src/app/editor/Toolbar.tsx`) and `SelectionContextMenuPlugin`
(`src/app/editor/SelectionContextMenuPlugin.tsx`).

`verveguy/zusammen`#117 needs to trigger this same pipeline from its own
right-click context menu, which — because it must intercept the same
`contextmenu` event this package's own selection-context-menu plugin already
listens for — is necessarily rendered as an ancestor of the editor, outside
the composer tree entirely. There is currently no way to reach the creation
pipeline from there.

Two more gaps in the same feature area block the same downstream issue:

- The toolbar's create-affordance button renders whatever `label` string a
  host supplies as plain text inside a 32×32 `.toolbar-button` box sized for a
  single glyph (see the existing bold/italic/link buttons in
  `Toolbar.tsx:316-376`). A multi-character label like `"Comment"` overflows
  that box rather than rendering as a compact icon.
- `SelectionContextMenuPlugin` mounts and its `contextmenu` listener runs
  unconditionally (`Editor.tsx:867-874`), regardless of whether any
  annotation kind is configured for the `contextMenu` surface or a host
  supplies `onSelectionContextMenu`. With neither, `SelectionContextMenu`
  still renders — currently an empty box (just padding, no menu items) — at
  `zIndex: 10000`, positioned at the click coordinates. A host that renders
  its own context menu on the same right-click (necessarily as an ancestor
  handler, since nothing in this plugin stops the native event from
  propagating there) ends up with this empty overlay sitting on top of, or
  next to, the host's real menu on every selection right-click.

All three gaps are filed together because they are small, touch the same
handful of files, and are needed together to land in one version bump for
`verveguy/zusammen`#117 to consume.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Host triggers annotation creation from outside the editor tree (Priority: P1)

A host application renders its own UI — e.g. a right-click context menu
mounted as an ancestor of `<Editor>`, outside the `LexicalComposer` tree —
and wants an item in that menu ("Add Comment") to trigger the exact same
comment-creation flow the package's own toolbar button already triggers,
anchored to whatever the user currently has selected in the editor.

**Why this priority**: This is the blocking gap for `verveguy/zusammen`#117:
without it, a host-rendered menu item has no way to reach the existing
creation pipeline at all.

**Independent Test**: Render `<Editor>` with `annotationKinds` configured for
a kind, obtain the populated `annotationEditorHandleRef`, select text in the
editor, call `handle.createAnnotation(kind)`, and observe the same
`onCreateAnnotation` callback fire (with a captured anchor) that clicking the
toolbar's affordance button for that kind would have produced.

**Acceptance Scenarios**:

1. **Given** an editor mounted with a configured annotation kind and a live
   `AnnotationEditorHandle` ref, and a non-collapsed native selection inside
   the editor, **When** a host calls `handle.createAnnotation(kind)`,
   **Then** the same anchor-capture-and-wrap flow that the toolbar button's
   click handler triggers runs, and the host's `onCreateAnnotation` fires
   with the captured anchor.
2. **Given** the same setup, **When** a host calls `handle.createAnnotation(kind)`
   for a `kind` that has no `createAffordance` configured, or with no native
   selection present, **Then** creation is declined exactly as it already is
   today when the toolbar dispatches `OPEN_ANNOTATION_COMPOSER_COMMAND` under
   the same conditions (silent no-op, save for the existing logger warning
   where one already fires).

---

### User Story 2 - Toolbar affordance renders as a correctly sized icon (Priority: P1)

A host configures a kind's `createAffordance` with a short icon in addition
to (or instead of) relying on the label being legible as button text, so
that the floating toolbar's comment button looks like a proper icon button —
matching the bold/italic/link buttons already in that toolbar — rather than
an overflowing text blob.

**Why this priority**: Directly blocks the visual fix `verveguy/zusammen`#117
needs, and is a one-file, additive change.

**Independent Test**: Configure a kind's `createAffordance` with
`{ surface: 'toolbar', label: 'Comment', icon: <Icon /> }`, select text so
the toolbar renders, and assert the affordance button (a) renders the icon
content, not the literal string "Comment", and (b) is still reachable via
`getByRole('button', { name: 'Comment', exact: true })`.

**Acceptance Scenarios**:

1. **Given** a kind's `createAffordance` includes an `icon`, **When** the
   toolbar renders that kind's affordance button, **Then** the button's
   visible content is the icon (fitting the existing 32×32 `.toolbar-button`
   box with no overflow), not the raw `label` text.
2. **Given** the same button, **When** its accessible name is queried,
   **Then** it equals (or is derived from) `label`, unchanged from today's
   behavior — an existing consumer test asserting
   `getByRole('button', { name: 'Comment', exact: true })` continues to pass.
3. **Given** a kind's `createAffordance` has no `icon` (existing consumers,
   unchanged), **When** the toolbar renders that button, **Then** it renders
   exactly as it does today — the text `label` as the button's visible
   content.

---

### User Story 3 - Unconfigured selection context menu produces no DOM output (Priority: P1)

A host has not configured any annotation kind for the `contextMenu` surface
and does not pass `onSelectionContextMenu`. The host renders its own
right-click context menu on selected text via an ancestor handler. Today,
right-clicking a selection still makes `SelectionContextMenuPlugin` render
its (empty) overlay on top of / alongside the host's real menu. This story
removes that vestigial output.

**Why this priority**: Directly blocks `verveguy/zusammen`#117's own
context-menu integration — two overlapping menu surfaces on every selection
right-click is a visible regression the host cannot work around from its own
code.

**Independent Test**: Mount `<Editor>` with no `contextMenu`-surfaced kind
configured and no `onSelectionContextMenu` prop. Right-click a text
selection inside the editor. Assert nothing rendered by
`SelectionContextMenuPlugin` appears in the DOM.

**Acceptance Scenarios**:

1. **Given** zero configured annotation kinds use `surface: 'contextMenu'`
   and no `onSelectionContextMenu` is supplied, **When** the user
   right-clicks a non-collapsed selection, **Then**
   `SelectionContextMenuPlugin` produces no DOM output at all.
2. **Given** at least one configured kind uses `surface: 'contextMenu'`, OR
   `onSelectionContextMenu` is supplied, **When** the user right-clicks a
   non-collapsed selection, **Then** `SelectionContextMenuPlugin` behaves
   exactly as it does today (menu appears with the relevant items).

---

### Edge Cases

- `createAnnotation(kind)` is called while no native selection exists, or the
  selection is collapsed: matches today's existing bail-out in
  `AnnotationPlugin`'s command handler (returns without capturing or
  notifying the host).
- `createAnnotation(kind)` is called for a `kind` string that is not present
  in the host's configured `annotationKinds`, or whose `createAffordance` is
  absent/null: matches today's existing decline-with-warning behavior.
- `createAnnotation(kind)` is called before the editor has mounted (handle is
  `null`) or after it has unmounted (handle reset to `null`): there is
  nothing to call — this is the existing contract of every other
  `AnnotationEditorHandle` method and is unchanged by this issue.
- A kind's `createAffordance` supplies `icon` but an empty-string or
  whitespace-only `label`: out of scope to newly validate — behaves exactly
  as an empty/whitespace `label` does today for a text-only affordance
  (existing behavior, not a regression surface for this issue).
- A kind's `createAffordance` on the `contextMenu` surface supplies `icon`:
  the context menu's own list-item rendering is out of scope for this issue
  (see Out of Scope) — `icon` is consulted only by the toolbar's rendering.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `AnnotationEditorHandle` MUST gain a new method,
  `createAnnotation(kind: AnnotationKind): void`, that dispatches
  `OPEN_ANNOTATION_COMPOSER_COMMAND` with `{ kind }` on the live editor
  instance backing the handle — the same dispatch the toolbar's affordance
  button click handler already performs. No new command type and no
  anchor/range plumbing through the handle: the dispatched command already
  reads `window.getSelection()` live, as it does today.
- **FR-002**: `createAnnotation` MUST be populated on the handle under the
  same conditions `removeMarksForAnnotation` and `collectLiveAnchorSnapshots`
  already are (i.e. whenever `annotationEditorHandleRef` is supplied and the
  annotation surface is mounted), and MUST become unreachable (handle reset
  to `null`) on the same unmount path those methods already follow.
- **FR-003**: `AnnotationCreateAffordance` MUST gain a new optional field,
  `icon`, alongside the existing `surface` and `label` fields. Supplying
  `icon` MUST NOT be required for existing consumers — omitting it MUST
  produce byte-for-byte the same rendering as today.
- **FR-004**: When a toolbar-surfaced kind's `createAffordance.icon` is
  present, `Toolbar`'s rendering of that kind's affordance button MUST use
  the icon as the button's visible content instead of the plain-text
  `label`, and that content MUST fit the existing 32×32 `.toolbar-button` box
  with no visible overflow (matching how the existing bold/italic/link
  glyphs fit it today).
- **FR-005**: Regardless of whether `icon` is present, the affordance
  button's accessible name (`aria-label`, and whatever else currently
  derives from `label`) MUST remain equal to (or derived from) `label` —
  this is a hard compatibility requirement, since a consuming host's existing
  test suite queries this button by
  `getByRole('button', { name: 'Comment', exact: true })`.
- **FR-006**: `AnnotationCreateAffordance` — and the new `icon` field
  specifically — is defined in `src/annotations/types.ts`, which is reachable
  from the `./annotations` subpath entry point
  (`src/annotations.ts`). That subpath is contractually headless: an existing
  test (`src/__tests__/annotations-subpath.test.ts`) statically walks its
  import graph and fails if `react`, `react-dom`, `lucide-react`, `zustand`,
  `lexical`, or any `@lexical/*` package appears anywhere in it — including
  through a type-only import, since the graph walk is a textual scan of every
  `from '...'` specifier and does not distinguish `import type` from a value
  import. Whatever representation `icon` uses MUST NOT introduce any such
  specifier into that module's (or anything it transitively imports') source
  text. `Toolbar.tsx`, which is outside the headless subpath, has no such
  restriction and may freely import from `react` or `lucide-react` (already a
  runtime dependency, already used elsewhere in this package for icons — see
  `src/app/editor/nodes/C4Component.tsx`) to interpret whatever `icon`
  representation is chosen.
- **FR-007**: `SelectionContextMenuPlugin` MUST produce no DOM output when
  both of the following hold: (a) the `annotationAffordances` list it
  receives is empty (no configured kind uses `surface: 'contextMenu'`), and
  (b) no `onSelectionContextMenu` prop is supplied. This condition is
  computed exactly as `Editor.tsx` already computes
  `contextMenuAnnotationAffordances` and already receives
  `onSelectionContextMenu` — no new prop plumbing.
- **FR-008**: When either condition in FR-007 does not hold (at least one
  `contextMenu`-surfaced kind is configured, or `onSelectionContextMenu` is
  supplied), `SelectionContextMenuPlugin` MUST behave exactly as it does
  today — this issue changes only the zero-configuration case.
- **FR-009**: This issue does not require any change to whether
  `SelectionContextMenuPlugin`'s native `contextmenu` listener calls
  `preventDefault()` in the zero-configuration case — only whether its menu
  overlay renders. (See Assumptions.)

### Key Entities

- **`AnnotationEditorHandle`** (`src/annotations/types.ts`): the imperative
  bridge a host holds to reach a mounted editor's annotation mechanism from
  outside the composer tree. Gains `createAnnotation`.
- **`AnnotationCreateAffordance`** (`src/annotations/types.ts`): per-kind
  configuration of where and how a user-initiated create action is offered.
  Gains `icon`.
- **`SelectionContextMenuPlugin`** (`src/app/editor/SelectionContextMenuPlugin.tsx`):
  the plugin mounted unconditionally inside every editor instance that shows
  a context menu over a text selection. Gains a no-op path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host holding a populated `AnnotationEditorHandle` can call
  `createAnnotation(kind)` with a live native selection and observe
  `onCreateAnnotation` fire with a captured anchor — with no code inside the
  `LexicalComposer` tree involved in triggering it.
- **SC-002**: A toolbar affordance button configured with `icon` renders with
  no visible text overflow of the 32×32 `.toolbar-button` box, while
  `getByRole('button', { name: <label>, exact: true })` continues to locate
  it.
- **SC-003**: With no `contextMenu`-surfaced kind configured and no
  `onSelectionContextMenu` supplied, right-clicking a text selection
  produces zero DOM nodes from `SelectionContextMenuPlugin`.
- **SC-004**: Every existing test in `src/app/editor/__tests__/toolbar-annotation-create.test.tsx`,
  `src/app/editor/__tests__/selection-context-menu-selection.test.tsx`, and
  `src/app/editor/__tests__/annotation-plugins.test.tsx` continues to pass
  unmodified in behavior (new tests may be added alongside them).
- **SC-005**: `src/__tests__/annotations-subpath.test.ts` continues to pass
  unmodified — the `./annotations` subpath's import graph gains no new
  forbidden specifier.

## Assumptions

- No existing shared "icon" abstraction exists elsewhere in this codebase to
  reuse for `AnnotationCreateAffordance.icon`. `lucide-react` is already a
  runtime dependency and is already used for icons in
  `src/app/editor/nodes/C4Component.tsx`, but that usage is inside a
  component file, not inside a plain-data type. Resolving `icon`'s concrete
  type (e.g. a `ReactNode`-shaped value defined somewhere that does not pull
  `react` into `src/annotations/types.ts`'s import graph, versus a
  string/enum reference `Toolbar.tsx` maps to a `lucide-react` icon
  component) is left to the Research/Plan stage, constrained by FR-006.
- `SelectionContextMenuPlugin`'s existing `preventDefault()` call on the
  native `contextmenu` event (when a non-collapsed selection exists) is left
  unchanged by this issue in the zero-configuration case — only whether the
  overlay component renders changes. If Research finds a reason this should
  also change (e.g. to let a host's own `preventDefault` govern the native
  browser menu instead), that is a follow-up, not part of this issue's
  acceptance.
- Publishing a new `@liminis/editor` version to consume from
  `verveguy/zusammen` is out of scope for this issue — this repository's
  release process (`.github/workflows/publish.yml`, gated on
  `LIMINIS_ALLOW_PUBLISH`) is a separate, deliberate step outside this
  pipeline.
- `AnnotationKind` is already `type AnnotationKind = string` — `kind` in
  `createAnnotation(kind: AnnotationKind)` is not a new type, just the
  existing one used as the parameter type.

## Out of Scope

- Rendering `icon` anywhere other than the toolbar surface (e.g. in
  `SelectionContextMenu`'s own list items) — the issue's reported visual bug
  is specific to the 32×32 `.toolbar-button` box.
- Any change to the `correction`-kind special-case behavior in
  `SelectionContextMenuPlugin` (opening the legacy correction panel) beyond
  what already happens today.
- Any change to `SelectionContextMenuPlugin`'s behavior when it *is*
  configured (at least one `contextMenu`-surfaced kind, or
  `onSelectionContextMenu` supplied) — this issue touches only the
  zero-configuration case.
- `verveguy/zusammen`'s own context-menu implementation or its consumption of
  the new `createAnnotation` method — that work happens in that repository
  once this ships.
- Bumping the package version or publishing a release.

## Source References

- `verveguy/zusammen`#117 (the downstream issue this unblocks)
- ADR-077 (`docs/decisions/adr-077.md`) — the unified annotation model these
  three additions extend
- `src/annotations/types.ts` — `AnnotationEditorHandle`, `AnnotationCreateAffordance`
- `src/app/editor/AnnotationPlugin.tsx` — the existing
  `OPEN_ANNOTATION_COMPOSER_COMMAND` handler `createAnnotation` reuses
- `src/app/editor/AnnotationSurface.tsx` — `AnnotationEditorHandlePlugin`,
  where the handle is currently assembled
- `src/app/editor/Toolbar.tsx` — the existing affordance button rendering
- `src/app/editor/SelectionContextMenuPlugin.tsx` — the plugin gaining the
  no-op path
- `src/app/editor/Editor.tsx:660-682, 867-874` — where the toolbar/context-menu
  affordance lists are already derived and where
  `SelectionContextMenuPlugin` is mounted
- `src/__tests__/annotations-subpath.test.ts` — the headless-subpath
  import-graph guard FR-006 must not trip
- `docs/annotations.md`, `docs/editor-api.md` — existing docs describing
  `AnnotationEditorHandle` and `createAffordance`, which will need updating
  alongside the implementation

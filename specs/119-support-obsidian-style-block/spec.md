# Feature Specification: Block transclusion via `![[file#^blockid]]`

**Feature Branch**: `fabrik/issue-119`
**Created**: 2026-09-08
**Status**: Specified
**Input**: User description: "Extend the existing `[[wikilink]]` support with Obsidian-style block references and transclusion: `[[file#^id]]` as a link-only pointer to a specific block, and `![[file#^id]]` to render that block's live content inline."

## Background

The consuming host app (Liminis) already writes stable ULID block IDs on
structured content, most heavily on action-item checkboxes:

```markdown
- [ ] @me Draft the boundary doc by 2026-09-15 ^01M00VDX0S4JHMDNA7F776Y8R8
```

Today that `^ULID` is inert as far as this package is concerned — it's a
host-side convention (used to unify restated action items and flip every
occurrence on completion), not something the editor's markdown pipeline or
renderer understands. Meanwhile `[[wiki-links]]` are already a first-class
feature (README: "wiki-links"; a vendored mdast extension parses `[[...]]`
and resolves to a file), but only at file granularity — there's no way to
link to, or embed, one specific block inside a file.

This issue adds two related capabilities, built on the same `[[...]]`
syntax already in use rather than a second bracket family:

1. **Block-scoped links** — `[[path/to/file.md#^ULID]]` resolves to a
   specific block inside a file, the same way today's `[[path/to/file.md]]`
   resolves to the file itself. Clicking navigates to that block.
2. **Transclusion** — `![[path/to/file.md#^ULID]]` renders that block's
   actual current content inline at the reference site. This is a live
   view, not a copy: if the source block's text changes (e.g. an action
   item flips from `[ ]` to `[x]`, or gets retired to `[-]`), every
   transclusion of it reflects that on next render.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link to a specific block, not just a file (Priority: P1)

As an author, I want to write `[[file#^id]]` to point at one specific block
inside a file, so that following the link takes a reader to that block
rather than just opening the file at the top.

**Why this priority**: This is the foundational capability transclusion is
built on — the same target+id addressing is reused by User Story 2.

**Independent Test**: Parse `[[file.md#^ULID]]` and verify it produces a
link distinguishable from a file-only `[[file.md]]` wikilink, carrying both
the file target and the block id; verify activating it requests navigation
to that specific block.

**Acceptance Scenarios**:

1. **Given** a document containing `[[notes.md#^01ABC]]`, **When** it is
   parsed, **Then** it produces a link carrying both the file target and the
   block id, distinct from a plain file-level wikilink to `notes.md`.
2. **Given** a host that understands block-level navigation, **When** the
   link is activated, **Then** the host receives a navigation request for
   that specific file *and* block id, not just the file.
3. **Given** a host with no block-level navigation wired up, **When** the
   link is activated, **Then** it degrades no worse than today's file-only
   wikilink navigation (it still opens the file), rather than doing nothing
   or throwing.

---

### User Story 2 - Live transclusion of a block's content (Priority: P1)

As a reader, I want `![[file#^id]]` to render the referenced block's actual,
current content inline, so that when the source block changes (a checkbox
gets ticked, a task gets retired), every place that block is transcluded
reflects the change without manual re-syncing.

**Why this priority**: This is the feature's core value proposition — a
live view is explicitly what distinguishes transclusion from a copy-paste
or a plain link, per the issue's own description.

**Independent Test**: Render a document containing `![[file#^id]]`,
observe it displays the block's real content (not the literal `![[...]]`
text); mutate the source block; re-render; verify the transclusion(s)
reflect the new content.

**Acceptance Scenarios**:

1. **Given** a host resolver capable of returning block content, **When** a
   document contains `![[file.md#^ULID]]`, **Then** the rendered output
   shows that block's current content at the reference site.
2. **Given** the source block's content changes (e.g. `- [ ]` → `- [x]`),
   **When** the transcluding document is re-rendered, **Then** the
   transclusion reflects the updated content.
3. **Given** the same block is transcluded from multiple sites (in the same
   or different documents), **When** the source changes, **Then** all
   transclusion sites reflect the change on next render.

---

### User Story 3 - Renders safely with no resolver wired up (Priority: P1)

As a host that has not implemented the block-content lookup, I want
`![[file#^id]]` to render as a plain link or a clear placeholder rather
than throw, so this feature honors the same "renders in a host that
supplies nothing at all" guarantee every other capability in this package
already gives.

**Why this priority**: This is a project-wide invariant (see
`docs/architecture.md`), not a nice-to-have — a feature that can crash an
otherwise-default-configured `<Editor>` breaks a guarantee every existing
consumer already relies on.

**Independent Test**: Mount `<Editor>` with no host services injected at
all; render a document containing `![[file#^id]]`; verify it does not
throw and shows a visibly non-transcluded state.

**Acceptance Scenarios**:

1. **Given** `<Editor>` mounted with default (no-op) host services,
   **When** the document contains `![[file#^id]]`, **Then** it renders
   without throwing, as a plain link or an "unresolved" placeholder — never
   as blank/silent output and never a crash.
2. **Given** a resolver is supplied but cannot find a given `file#^id`
   (unknown block, or unknown file), **When** that reference is
   transcluded, **Then** it renders a clearly distinguishable "unresolved"
   state rather than throwing or rendering nothing.

---

### User Story 4 - A transclusion cycle fails safely (Priority: P1)

As a document author, if I (accidentally or otherwise) create a
transclusion cycle — block A transcludes block B, which transcludes block
A — I want the editor to detect it and show a clear fallback, so one
mistaken reference doesn't hang or crash the whole document.

**Why this priority**: Explicit correctness requirement in the originating
issue; without it, an authoring mistake produces an infinite render loop or
stack overflow rather than a contained, visible error.

**Independent Test**: Construct a fixture where block A's content
transcludes block B and block B's content transcludes block A; render the
document; verify rendering terminates and shows a clear circular-reference
indicator rather than hanging.

**Acceptance Scenarios**:

1. **Given** a direct cycle (A embeds B, B embeds A) or a self-reference (A
   embeds A), **When** rendered, **Then** rendering terminates with a
   "circular transclusion" indicator at the cycle point instead of an
   infinite loop or crash.
2. **Given** a longer cycle (A → B → C → A), **When** rendered, **Then**
   the same protection applies.
3. **Given** transclusion nested several levels deep but *not* circular,
   **When** rendered within a defined bounded depth, **Then** it renders
   correctly; beyond that bound, it degrades to a clear fallback rather
   than a crash.

---

### User Story 5 - Saving and reopening never rewrites the syntax (Priority: P1)

As an author, I want a document containing `[[file#^id]]` or
`![[file#^id]]` to come back out of the editor exactly as I wrote it, so
this feature doesn't silently corrupt documents on save the way a broken
round trip would.

**Why this priority**: This package's markdown round-trip contract (see
`docs/markdown-pipeline.md`) treats any regression here as a correctness
bug, not a cosmetic one — a document that changes on every open/save cycle
is functionally corrupted from the author's point of view.

**Independent Test**: Parse a markdown document containing block-scoped
links and transclusion embeds, serialize it back via `stringifyMarkdown`,
and diff against the original.

**Acceptance Scenarios**:

1. **Given** markdown containing `[[file.md#^ULID]]`, **When** parsed then
   re-serialized, **Then** the output is byte-identical to the input.
2. **Given** markdown containing `![[file.md#^ULID]]`, **When** parsed then
   re-serialized, **Then** the output is byte-identical to the input.
3. **Given** a document mixing existing plain/aliased wikilinks with new
   block-scoped links and transclusions (including inside a table cell),
   **When** round-tripped, **Then** none of the constructs corrupt each
   other (regression guard against the existing pipe-in-tables class of
   bug, #347).

---

### Edge Cases

- `[[file#^id]]` (link-only) referencing an id that doesn't exist → treated
  as unresolved, using the same "this doesn't exist yet" styling an
  unresolved file-only wikilink already gets — not an error.
- `![[file#^id]]` referencing a file that exists but a block id that
  doesn't (vs. a file that doesn't exist at all) → both are "unresolved"
  from the author's point of view; the resolver contract, not the parser,
  is responsible for distinguishing them if the host cares to.
- `![[file]]` written with no `#^id` fragment at all (i.e. whole-file
  transclusion syntax) is not a supported construct in v1 (see Non-Goals):
  it must not attempt to embed the whole file, and must not crash — it
  degrades to the same treatment as an ordinary file-level `[[file]]` link
  (no embedding).
- A block that has no `^id` in its source (the vast majority of blocks
  today) simply cannot be targeted — this is expected, not an error state;
  nothing about this feature requires retrofitting ids onto existing
  content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The parser MUST recognize `[[file#^id]]` as a block-scoped
  link, extending the existing wikilink construct with an optional `#^id`
  fragment rather than introducing a second, parallel bracket syntax.
- **FR-002**: The parser MUST recognize a leading `!` immediately before
  `[[file#^id]]` (i.e. `![[file#^id]]`) as a transclusion/embed construct,
  distinguishable from the link-only form of FR-001.
- **FR-003**: `stringifyMarkdown` MUST re-emit both `[[file#^id]]` and
  `![[file#^id]]` exactly as authored (byte-identical round trip),
  consistent with this package's existing markdown round-trip contract.
- **FR-004**: Activating a block-scoped link (`[[file#^id]]`) MUST request
  navigation to that specific block when the host supports it; when it
  doesn't, it MUST degrade no worse than today's file-only wikilink
  navigation.
- **FR-005**: `![[file#^id]]` MUST render the referenced block's actual,
  current content inline at the reference site — a live view, not a static
  copy captured at authoring time.
- **FR-006**: When the same block is transcluded from multiple sites, all
  of them MUST reflect a change to that block's source content on next
  render.
- **FR-007**: Resolving `file#^id → content` MUST be obtained through an
  optional, host-injected function, consistent with this package's
  existing host-seam design (every environment dependency is optional and
  has a safe default — see `docs/architecture.md`, `docs/editor-api.md`).
- **FR-008**: With no such resolver injected, `![[file#^id]]` MUST render
  without throwing — as a plain link or a clearly marked "unresolved"
  placeholder — and MUST NOT execute or interpret the referenced content as
  anything other than inert display data.
- **FR-009**: When a resolver is present but cannot resolve a given
  `file#^id`, the transclusion MUST render a clearly distinguishable
  "unresolved" state rather than throwing or silently rendering nothing.
- **FR-010**: The system MUST detect a transclusion cycle (a block
  transitively transcluding itself) and render a clear fallback (e.g. a
  "circular transclusion" indicator) at the point of detection, instead of
  an infinite loop, unbounded recursion, or a crash.
- **FR-011**: Nested transclusion (a transcluded block that itself contains
  a transclusion) MUST be supported up to a bounded recursion depth;
  exceeding that bound MUST degrade to a clear fallback rather than a
  crash. The exact numeric bound is a Plan-stage decision.
- **FR-012**: Block ids MUST be resolved as workspace-global identifiers,
  not scoped to a single file — the resolver contract MUST be able to look
  up a block by id across the host's whole corpus, matching how Liminis
  already mints and reuses a `^ULID` across restated occurrences of the
  same action item.
- **FR-013**: `![[file]]` written without a `#^id` fragment MUST NOT
  attempt whole-file transclusion and MUST NOT crash; it is not a
  supported construct in v1 (see Non-Goals).
- **FR-014**: This feature MUST NOT change how existing file-only
  `[[target]]` / `[[target|alias]]` wikilinks (no `#^id` fragment) parse,
  resolve, render, or round-trip.
- **FR-015**: Anchoring MUST NOT be special-cased to checkbox/task-list
  blocks — any block-level node that carries a trailing `^id` in its source
  markdown is a valid transclusion/link target, consistent with the
  upstream Obsidian block-reference convention. Checkbox action items are
  simply the only case the host currently emits ids for.

### Key Entities

- **Block-scoped link**: an extension of the existing wikilink construct
  carrying an optional block-id fragment; link-only, does not render
  referenced content.
- **Transclusion (embed)**: the `!`-prefixed form of the same target+id
  addressing; renders the resolved block's current content in place of the
  reference.
- **Block resolver (host service)**: an optional host-supplied function
  mapping a workspace-global `file#^id` reference to block content (and/or
  existence), analogous in spirit to the existing `resolveWikiLinks` host
  service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A document containing `[[file#^id]]` and `![[file#^id]]`
  round-trips through parse→stringify byte-identically, verified by
  automated test.
- **SC-002**: A rendered transclusion reflects a change to its source
  block's content after the source changes and the document re-renders,
  verified by automated test.
- **SC-003**: `<Editor>` mounted with default host services (nothing
  injected) renders a document containing `![[file#^id]]` without
  throwing.
- **SC-004**: A constructed transclusion cycle renders a bounded, clear
  fallback rather than hanging or crashing, verified by automated test.
- **SC-005**: The existing wiki-link test suite (file-only links, aliases,
  the #347 pipe-in-tables regression guard) continues to pass unmodified.

## Assumptions

- **Block ids are workspace-global**, matching Liminis's existing `^ULID`
  convention (used to unify restated action items and flip every
  occurrence on completion). This resolves the ID-scope question the
  originating issue draft left open for this stage — see FR-012.
- **v1 anchors any `^id`-carrying block, not only checkboxes.** The
  originating issue draft's own non-goals wording ("action items today;
  any `^id`-anchored block in general") and the upstream Obsidian
  block-reference convention both point the same way — see FR-015. This
  resolves the second question the originating issue draft left open for
  this stage.
- The exact shape of the host-injected resolver (its name, signature,
  sync vs. async, and whether it extends `resolveWikiLinks` or is a new
  sibling function) is a Research/Plan-stage decision; this spec requires
  only that such a seam exists and behaves per FR-007–FR-009.
- The specific bounded recursion depth for nested transclusion (FR-011) is
  a Plan-stage numeric decision.
- The rendered appearance of "unresolved" and "circular transclusion"
  fallback states (copy, styling) is an implementation decision; this spec
  requires only that each is visually distinguishable from a successful
  transclusion and from one another.

## Out of Scope

- **Bidirectional editing.** Editing rendered transcluded content does not
  write back to the source block — render-only for this iteration.
- **Whole-file transclusion** (`![[file]]` with no anchor) — see FR-013.
- **Minting or requiring a new block-id scheme.** This feature only
  consumes the existing host-authored `^ULID` convention; it does not
  generate ids of its own.
- **Same-file shorthand** (`[[#^id]]` / `![[#^id]]` with no explicit file
  segment, as Obsidian separately supports for same-document references) —
  not required in v1; only the explicit `file#^id` form is in scope.
- **The host's own resolver implementation** (e.g. Liminis's corpus-wide
  id index). This issue delivers the package-side capability and contract;
  wiring up an actual lookup across a real document store is the
  consuming host's work, not this package's.

## Source References

- `docs/architecture.md`, `docs/editor-api.md` — the host-seam /
  `EditorHostServices` pattern this feature's resolver must follow, and
  the existing `resolveWikiLinks` service it is analogous to.
- `docs/markdown-pipeline.md` — the existing wiki-link mdast extension,
  the round-trip contract, and the #347 pipe-in-tables precedent for
  wiki-link edge cases inside tables.
- `dist/markdown/vendor/mdast-util-wiki-link/` — the vendored wiki-link
  extension this feature extends rather than duplicates.

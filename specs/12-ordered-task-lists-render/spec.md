# Feature Specification: Ordered task lists render real checkboxes instead of literal `[ ]` text

**Feature Branch**: `fabrik/issue-12`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "Ordered task lists render literal `[ ]` text instead of checkboxes"

## Background

An ordered task list (`1. [ ] Task one`) renders its checkbox marker as **literal text** in the
editor — the user sees `1. [ ] Task one` on the page rather than a numbered item with a checkbox.
The unordered form (`- [ ] Task one`) renders correctly, as a real checkbox.

This was found within minutes of the Electron shell (verveguy/liminis-editor#2) existing, by loading
`src/app/mapper/__tests__/fixtures/roundtrip/897-list-item-block-content/ordered-task-list-leading-link.md`,
and is reproducible with the existing `ordered-task-list.md` round-trip fixture.

**Cause.** `convertListItem` in `src/app/mapper/mdastToLexical.ts` deliberately avoids Lexical's
built-in checklist rendering (`listType = 'check'`) for ordered lists, because that rendering mode
is gated on the parent list's `listType` and Lexical does not support a `'check'` list that is also
numbered. As a workaround, the importer instead prefixes the literal characters `[ ] ` or `[x] ` onto
the item's first paragraph, so the document still round-trips byte-for-byte through Markdown. The
per-item checked state is, at the same time, stored correctly and independently: `CustomListItemNode`
(`src/app/editor/nodes/CustomListItemNode.tsx`) carries a real tri-state `__taskChecked` field
specifically because stock `ListItemNode.getChecked()` is derived from the parent list's `listType`
and cannot distinguish a plain item from an unchecked task in a mixed list. `convertListItem` already
calls `listItem.setTaskChecked(node.checked ?? null)` on every item, ordered or not — the correct
state is present on the node whether or not it is rendered as a checkbox. Only the *rendering* of
ordered items declines to use it, and compensates by duplicating the marker as visible, editable text.

**Why this matters beyond appearance.**

- **The round-trip corpus cannot see this defect.** `ordered-task-list.md` passes today's fixture
  suite because the input text and the output text are identical — the marker is preserved *as
  text*, so a suite that only asserts serialization fidelity has nothing to catch. The defect is
  only observable by rendering the document, which is exactly what verveguy/liminis-editor#2's
  shells exist to do, and it is the first concrete defect they've found.
- **The literal marker is editable, and can be corrupted by ordinary editing.** Because `[ ] ` is
  real character content in the item's paragraph, a user can position a cursor inside it and delete
  the `]`, the space, or any other character, same as with any other text. The next Markdown parse
  reads whatever characters remain, which may no longer form a valid task-list marker — silently
  changing the item from a task to a plain list item (or leaving stray bracket characters as visible
  prose) with no warning. An unordered task item has no equivalent hazard, because its checkbox is
  rendered UI, not paragraph text.

This issue is a rendering-only defect: the state model (`CustomListItemNode.__taskChecked`) and the
Markdown parse/serialize behavior for task-list syntax are already correct. The fix is confined to
how an ordered task item is imported into Lexical (and, on the export side, how a fixed item is
recognized so the existing "avoid duplicate markers" logic in `src/app/mapper/lexicalToMdast.ts`
continues to produce exactly one marker in the saved Markdown).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An ordered task item renders as a checkbox, not as bracket text (Priority: P1)

A user opens a Markdown document containing an ordered task list, e.g.:

```markdown
1. [ ] Task one
2. [x] Task two
```

They see two numbered items, each with a real, rendered checkbox reflecting its checked state — not
the literal characters `[ ]` or `[x]` as part of the visible text.

**Why this priority**: This is the defect as reported — the primary, user-visible symptom.

**Independent Test**: Load `ordered-task-list.md` (and the `897-list-item-block-content` ordered
task fixtures) into a shell that actually renders the document (not just round-trips its text), and
assert that each item exposes a checkbox affordance and that no literal `[ ]`/`[x]` characters appear
in the item's rendered text content.

**Acceptance Scenarios**:

1. **Given** a Markdown document containing `1. [ ] Task one`, **When** it is loaded into the editor,
   **Then** item 1 renders as a numbered, unchecked checkbox item, with no literal `[ ]` text visible.
2. **Given** a Markdown document containing `2. [x] Task two`, **When** it is loaded into the editor,
   **Then** item 2 renders as a numbered, checked checkbox item, with no literal `[x]` text visible.
3. **Given** the same document, **When** rendered, **Then** the list items remain visibly numbered
   (ordered-list rendering is not lost or replaced by unordered/bullet rendering).

---

### User Story 2 - Toggling an ordered item's checkbox updates the saved document (Priority: P1)

A user clicks the checkbox on an ordered task item to check or uncheck it, the same way they can
already do for an unordered task item.

**Why this priority**: A checkbox that renders but cannot be toggled would be a half-fix — the
acceptance bar set by the issue explicitly requires toggling to work and to persist.

**Independent Test**: In a rendering shell, toggle an ordered item's checkbox, export the document
back to Markdown, and assert the `[ ]`/`[x]` state in the exported Markdown reflects the toggle, with
exactly one marker per item (no duplication from the old text-prefix path).

**Acceptance Scenarios**:

1. **Given** an ordered, unchecked task item rendered in the editor, **When** the user toggles its
   checkbox, **Then** the item's checked state changes and is reflected the next time the document is
   exported to Markdown as `[x]`.
2. **Given** a document that has just been round-tripped once after such a toggle, **When** it is
   round-tripped a second time (parse → import → export → stringify), **Then** the second pass is
   identical to the first (fixed point) — toggling does not introduce further drift.

---

### Edge Cases

- **Mixed ordered list** (some items are tasks, some are plain list items): plain items must remain
  plain — unaffected by this change — while task items render checkboxes, matching how unordered
  lists already handle a mix of plain and task items today.
- **Ordered task item whose first paragraph starts with non-text inline content** (e.g. a leading
  link, per the `ordered-task-list-leading-link.md` fixture that surfaced this bug): the checkbox
  must render correctly and must not be conflated with, or inserted into, that inline content.
- **Ordered task list nested inside another list** (ordered or unordered): the nested items render
  checkboxes the same as top-level ordered task items.
- **An already-checked ordered item is unchecked (or vice versa) and the document is saved**: exactly
  one `[ ]`/`[x]` marker appears in the output for that item — never zero, never two.
- **Existing unordered checklist fixtures and behavior**: unchanged by this fix; unordered rendering,
  toggling, and round-tripping must continue to pass exactly as before.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An ordered list item whose Markdown source carries a task-list marker (`[ ]` or `[x]`)
  MUST render a checkbox reflecting its checked state, while remaining part of a numbered (ordered)
  list.
- **FR-002**: The checkbox state for an ordered task item MUST be sourced from the item's own stored
  checked state (already tracked per-item, independent of the parent list's ordered/unordered type),
  not re-derived from, or gated on, the parent list's rendering mode.
- **FR-003**: The task marker MUST NOT appear as literal, user-editable text within the item's
  paragraph content. Editing the item's text (including deleting individual characters anywhere in
  it) MUST NOT be able to change or corrupt the item's checked state or turn it into stray visible
  bracket characters.
- **FR-004**: A user MUST be able to toggle an ordered task item's checkbox (check/uncheck) through
  the same kind of interaction already available for unordered task items, and the toggle MUST update
  the item's stored checked state.
- **FR-005**: Exporting a document containing ordered task items to Markdown MUST emit exactly one
  `[ ]`/`[x]` marker per task item, matching its current checked state, whether or not the item was
  toggled after import.
- **FR-006**: The full pipeline (parse Markdown → import to Lexical → export from Lexical → stringify
  to Markdown) MUST reach a fixed point on the second pass for documents containing ordered task
  lists, including after a checkbox has been toggled.
- **FR-007**: A plain (non-task) item within an ordered list that also contains task items MUST be
  unaffected — it renders with no checkbox and no marker, exactly as it does today.
- **FR-008**: Unordered task-list rendering, toggling, and round-tripping MUST be unchanged by this
  fix; all existing unordered task-list fixtures and tests continue to pass as-is.
- **FR-009**: A rendering-level assertion (not merely a text/serialization comparison) MUST cover both
  the ordered and unordered checkbox forms, running in one of the project's rendering shells
  (`examples/electron` and/or `examples/demo`) rather than only in the text-based round-trip corpus —
  since FR-001/FR-003 are exactly the class of defect that corpus cannot observe.

### Key Entities

- **Task list item**: a list item (ordered or unordered) whose Markdown source used GFM task-list
  syntax (`[ ]`/`[x]`). Modeled by `CustomListItemNode`, which stores its checked state independently
  of the parent list's ordered/unordered type or Lexical's `listType`.
- **Round-trip fixture**: a Markdown file in the package's round-trip corpus
  (`src/app/mapper/__tests__/fixtures/roundtrip/`) used to assert text-level parse/stringify fidelity.
  This issue adds rendering-level coverage that such fixtures alone cannot provide.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Loading `ordered-task-list.md` and the `897-list-item-block-content` ordered-task
  fixtures into a rendering shell shows real, numbered checkbox items with no literal `[ ]`/`[x]`
  text visible.
- **SC-002**: Toggling an ordered item's checkbox in a rendering shell and exporting the document
  produces Markdown with exactly one correctly-stated marker per item, and a second round-trip pass
  is a fixed point.
- **SC-003**: All existing round-trip fixtures — including the existing ordered- and unordered-task
  fixtures — continue to pass unchanged.
- **SC-004**: A new rendering-level test (in `examples/electron` and/or `examples/demo`) asserts both
  ordered and unordered checkbox rendering and is part of the suite that runs in CI.
- **SC-005**: The full project check suite (typecheck, lint, build, test) passes.

## Assumptions

- The correct per-item checked state already exists on `CustomListItemNode` (`__taskChecked`) for
  both ordered and unordered items; this issue is a rendering/import defect, not a state-modeling
  defect, and does not require changes to that field's semantics.
- The Markdown parse/serialize layer's understanding of ordered task-list syntax is already correct
  (GFM task-list syntax is recognized identically for ordered and unordered lists); this issue does
  not require parser or serializer changes to how `[ ]`/`[x]` syntax is recognized on read.
- "A rendering shell" (FR-009/SC-004) may be either of the project's existing rendering test
  surfaces — the Electron e2e shell (`examples/electron`) or the web demo shell (`examples/demo`) —
  or both; this spec does not mandate a specific one, since either demonstrates the rendering
  behavior that the text-only round-trip corpus cannot.
- This issue is scoped to the rendering/toggle/round-trip behavior described above. The precise
  technical mechanism (e.g., whether Lexical's existing checklist rendering is extended to work
  alongside ordered numbering, versus a different rendering approach for the checkbox itself) is a
  Research/Plan-stage decision, not fixed by this spec — the issue's own "Suggested direction" and
  documented fallback are input to that decision, not a requirement.

## Out of Scope

- Any other known Markdown round-trip idempotence or fidelity defect already tracked under
  `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/` (e.g. the existing ordered-list
  code-block, table, blockquote, and multi-paragraph known defects) — unrelated to this issue and
  untouched by it.
- Changes to how unordered task lists render, toggle, or round-trip — already correct, and FR-008
  requires them to remain unchanged.
- Migration or repair of documents that already contain literal `[ ] `/`[x] ` text as a result of this
  defect having previously round-tripped them that way, if any such documents exist outside the
  fixture corpus.
- New task-list features (e.g. indeterminate state, custom marker styles) beyond restoring correct
  checkbox rendering for the existing tri-state (`checked` / `unchecked` / `not a task`) model.

## Source References

- `src/app/mapper/mdastToLexical.ts` — `convertListItem` (~line 686), `convertList`; the import-side
  workaround (`useChecked`, `shouldPrefixTaskMarker`) that prefixes literal marker text for ordered
  items.
- `src/app/mapper/lexicalToMdast.ts` (~line 960-1010) — export-side checked-state resolution and the
  existing `hasExplicitMarker` handling that avoids emitting a duplicate marker.
- `src/app/editor/nodes/CustomListItemNode.tsx` — `__taskChecked` tri-state field and its docstring
  explaining why it must not be derived from Lexical's stock `getChecked()`/`listType`.
- `src/app/mapper/__tests__/fixtures/roundtrip/ordered-task-list.md`,
  `src/app/mapper/__tests__/fixtures/roundtrip/897-list-item-block-content/ordered-task-list-leading-link.md`,
  `.../ordered-task-list-block-content.md` — existing fixtures that reproduce the defect.
- `examples/electron/e2e/electron-shell.spec.ts`, `examples/demo` — existing rendering shells,
  candidates for the rendering-level assertion required by FR-009.
- verveguy/liminis-editor#2 — the Electron/web shells whose existence surfaced this defect.

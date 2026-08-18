# Feature Specification: Extract the Table-of-Contents / Document Outline Widget into `@liminis/editor`

**Feature Branch**: `fabrik/issue-69`
**Created**: 2026-08-18
**Status**: Specified
**Input**: User description: "Extract the Table-of-Contents / document outline widget from liminis-app into the editor package"

## Background

The Liminis app has a document outline / table-of-contents view built into its editor
surface (`liminis-app/src/renderer/components/TableOfContents.tsx`), but it lives in
the app, not in `@liminis/editor`. Consumers of the package (e.g. Zusammen) can't offer
an outline without reimplementing it. This extracts the widget into the editor package
as a considered export, so any consumer gets a heading outline of the current document
— navigable, with active-heading tracking — as part of the editor surface.

### What the app version does today

- Derives the outline by parsing the document's markdown and walking headings —
  already via this package's own API (`parseMarkdown`, `isHeading`, `isText`,
  `isInlineCode` from `@liminis/editor/markdown`): H1–H5, in document order, text
  extracted (incl. inline code), nested by level.
- Renders an "On this page" list: indented by level, long titles truncated, a
  highlighted active entry with an indicator bar; clicking an entry navigates to that
  heading.
- **Scroll-spy**: tracks which heading is at the top of the viewport as the reader
  scrolls, and marks it active — keying off the editor's own rendered heading DOM
  (`.editor-heading-h1…h5`) within the editor's scroll container.
- **Scroll-to**: clicking an entry scrolls the editor to the Nth heading element.

It also has a raw-markdown (line-based) variant and app-level policy (width-gating,
collapse persistence) — see Out of Scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and navigate a document's outline (Priority: P1)

As a consumer embedding the editor, I want to render an outline of the current
document's headings and let the reader jump to any of them, without writing my own
heading parser.

**Why this priority**: This is the widget's core value. Without a heading list and the
ability to jump to a heading, there is nothing to extract.

**Independent Test**: Mount the widget against a document fixture containing nested
headings (including skipped levels and duplicate titles); verify the rendered list
order, nesting, and text extraction, and that activating an entry scrolls the editor to
the corresponding heading.

**Acceptance Scenarios**:

1. **Given** a document with headings, **When** I mount the outline widget, **Then** it
   lists the headings in order, indented by level, with inline formatting reduced to
   text.
2. **Given** the outline, **When** I click an entry, **Then** the editor scrolls that
   heading into view.
3. **Given** a document with no headings, **When** the widget renders, **Then** it
   renders nothing.

---

### User Story 2 - The outline tracks the reader's position (Priority: P1)

As a reader, I want the outline to show where I am in the document, so it's a live map
rather than a static list.

**Why this priority**: Without live tracking, the outline is just a static list of
headings — the scroll-spy behavior is what makes it a navigational aid rather than a
table of contents printed once.

**Independent Test**: Scroll the mounted editor's document across several headings and
observe that the corresponding outline entry becomes active as each heading crosses the
top of the viewport, and that the outline itself scrolls to keep the active entry
visible.

**Acceptance Scenarios**:

1. **Given** the outline, **When** I scroll the document, **Then** the entry for the
   heading currently at the top of the viewport becomes the active one.
2. **Given** the active entry changes, **When** it would be out of view in a long
   outline, **Then** the outline scrolls it into view.

---

### User Story 3 - The outline stays current (Priority: P2)

As a reader or writer, I want the outline to reflect the document as it changes, so I
don't have to remount the widget to see a new or renamed heading.

**Why this priority**: Lower priority than initial rendering/navigation and scroll
tracking — those two are the widget's reason to exist — but necessary for any real
editing session, where the outline would otherwise silently go stale.

**Independent Test**: With the widget mounted against a live document, add, edit, and
remove headings, and confirm the outline updates to match without requiring a remount.

**Acceptance Scenarios**:

1. **Given** the outline is showing, **When** headings are added, edited, or removed in
   the document, **Then** the outline updates to match.

---

### Edge Cases

- Documents with no headings (render nothing).
- Duplicate heading titles (selection/identity by position/index, not text).
- Skipped levels (H1 → H3) and deep nesting.
- Very long heading titles (truncation).
- Rapid scrolling / large documents (scroll-spy performance).
- The consumer's scroll container living outside the editor component (the seam must
  supply it — see FR-006).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package MUST export an outline/table-of-contents widget as part of
  the editor surface (a considered export from the DOM/React entry — not
  `annotations`/`headless`).
- **FR-002**: The widget MUST derive its entries from the current document's headings
  (H1–H5), in document order, nested by level, with heading text reduced from inline
  content (including inline code).
- **FR-003**: Activating an entry MUST scroll the editor to the corresponding heading.
  Because the package owns the editor and its heading nodes, this MUST be provided by
  the package, not left to the consumer.
- **FR-004**: The widget MUST track and highlight the heading currently at the top of
  the viewport as the document scrolls (scroll-spy), and keep the active entry visible
  within the outline.
- **FR-005**: The widget MUST update as the document's headings change.
- **FR-006**: The widget MUST NOT hardcode host DOM ids or assume a specific scroll
  container. The editor's scroll container / element positions MUST reach it through
  the editor-host seam (or be owned by the package), so it works for any consumer's
  layout.
- **FR-007**: The widget MUST render nothing when the document has no headings.
- **FR-008**: Visibility, placement, width-gating, and any collapse/persistence are the
  consumer's concern — the widget MUST NOT impose them.
- **FR-009**: The widget's markup and styling MUST follow the package's existing
  styling convention — semantic CSS shipped through the package's own stylesheet,
  themed via its runtime custom-property API — rather than Tailwind utility classes or
  a new third-party UI-kit dependency. (The package dropped its Tailwind coupling
  entirely per ADR-086; the app's current implementation uses Tailwind utility classes
  and a shadcn `ScrollArea` component throughout, neither of which the package may
  reintroduce.)

### Key Entities

- **Outline entry**: A single heading captured for display — its text (inline content
  reduced to plain text), heading level (H1–H5), nesting derived from level, and a
  position/index within the document. Identity for selection and active-tracking is by
  position/index, not text, so duplicate titles are handled correctly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A consumer can mount the widget and get a live, navigable heading outline
  of the current document with no bespoke heading parsing and no hardcoded DOM
  assumptions.
- **SC-002**: Clicking an entry scrolls the editor to that heading; the active entry
  reflects the heading at the top of the viewport and updates on scroll.
- **SC-003**: The outline reflects heading edits/additions/removals without a manual
  refresh.
- **SC-004**: With no headings, the widget contributes nothing to the layout.

## Assumptions

- WYSIWYG only. The app's raw-markdown, line-number-based outline variant is out of
  scope — the package has no raw/CodeMirror surface; liminis-app keeps that variant for
  its raw mode.
- Heading levels H1–H5, matching the app today.

## Out of Scope

- The app's raw-markdown (line-based) outline variant, including its `isRawMode` /
  `rawFirstVisibleLine` behavior — stays in liminis-app.
- Placement, visibility, width-gating, and collapse/persistence policy — these are the
  consumer's decision; this issue delivers the widget and its behavior, not a layout
  policy (FR-008).
- Any consumer-side work to mount, enable, or place the widget (e.g. in Zusammen) —
  tracked separately once the package exports it.

## Source References

- `liminis-app/src/renderer/components/TableOfContents.tsx` — the widget being
  extracted.
- `liminis-app/src/renderer/components/MarkdownEditorPanel.tsx` and
  `liminis-app/src/renderer/components/EditorColumn.tsx` — current wiring, including
  the WYSIWYG scroll-to-heading handler and the app-level width-gating/collapse policy
  that stays behind (Out of Scope).
- `src/host/types.ts`, `src/host/context.tsx` — the existing editor-host services seam
  that FR-006 extends.
- `docs/decisions/adr-086.md` — the package's no-Tailwind, semantic-CSS styling
  convention that FR-009 requires the new widget to follow.
- `src/index.ts` — the package's export-barrier convention ("add a considered export —
  never a deep import") that FR-001 follows.

# Feature Specification: DocumentOutline gains a markdown-derived entry source

**Feature Branch**: `fabrik/issue-84`
**Created**: 2026-08-19
**Status**: Specified
**Input**: User description: "DocumentOutline needs a markdown-derived entry source — raw-mode support was lost in extraction. Give DocumentOutline a markdown-derived entry source, so it works wherever there is markdown rather than only where there is a mounted Lexical editor. Blocks verveguy/liminis#1022, which cannot adopt DocumentOutline without it."

## Background

`0.2.0`'s `DocumentOutline` derives its entries from **live Lexical state** —
`OutlinePlugin` walks `HeadingNode`s on every editor update and feeds the shared
handle. That was a deliberate decision made in #69's plan, taken to avoid a second
markdown parse and to get #69's FR-005 ("the outline updates as headings change")
for free.

The cost of that decision was not recorded at the time, and it is real: **an outline
is only possible where a Lexical editor is mounted.** liminis-app has a raw markdown
mode that mounts `RawMarkdownEditor`, not the Lexical `Editor`. Under the current
design that mode has no data source for an outline at all — which is what stalled
[verveguy/liminis#1022](https://github.com/verveguy/liminis/issues/1022).

The implementation #69 extracted from — liminis-app's own `TableOfContents.tsx` —
already solved this. It derived entries from **markdown**, using this package's own
exported parser (`parseMarkdown`, `isHeading`, `isText`, `isInlineCode` from
`@liminis/editor/markdown`), and it carried each heading's mdast
`position.start.line` — a 1-based source line — which its raw-mode variant used to
scroll. Lexical state has no equivalent to that line mapping; the ability to produce
it does not exist on the Lexical path at all.

Two capabilities came from parsing markdown directly, and neither survived
extraction:

1. **Mode independence** — an entry source that works identically whether the host
   is showing WYSIWYG or raw markdown, because it only needs the markdown text.
2. **Line positions** — a 1-based source line per heading, which a raw-mode host can
   scroll by, since it has no Lexical tree to walk instead.

The scroll-*spy* mechanism is a separate concern from entry derivation, and #69
correctly identified its own problem: the app's WYSIWYG scroll-spy used
`document.querySelectorAll('.editor-heading-hN')`, which is multi-instance-unsafe,
and the per-instance handle genuinely fixes that. But #69's fix replaced *both*
entry derivation and scroll-spy with a Lexical-only mechanism, when only the second
needed to change. This issue restores the first without touching the second.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Render an outline with no Lexical editor mounted (Priority: P1)

As a host embedding the editor package in raw markdown mode (no Lexical `Editor`
mounted), I want to get a heading outline from the markdown text itself, so raw mode
has the same navigational aid WYSIWYG has, instead of no outline at all.

**Why this priority**: This is the gap the issue exists to close. Without an
entry source that works from markdown alone, raw mode has nothing, which is what
blocks liminis#1022.

**Independent Test**: Derive/render outline entries from a markdown string with no
`Editor` component and no `OutlinePlugin` mounted anywhere in the tree; verify the
resulting entries match the headings in that markdown — order, nesting, and text
extraction (including inline code )— using the same rules the WYSIWYG path uses.

**Acceptance Scenarios**:

1. **Given** a markdown string containing H1–H5 headings, **When** the outline is
   derived from that markdown with no Lexical editor mounted, **Then** it produces
   entries in document order, nested by level, with heading text reduced from inline
   content (including inline code) — matching what the same document would produce
   via the Lexical/WYSIWYG path.
2. **Given** a markdown string with no headings, **When** the outline is derived from
   it, **Then** it renders nothing (mirrors #69's FR-007).

---

### User Story 2 - Entries carry a source line for line-based navigation (Priority: P1)

As a raw-mode host with no Lexical tree, I want each outline entry to know which
source line its heading came from, so I can scroll my own (non-Lexical) editor to
it, and so I can tell the outline which line is currently in view to highlight the
right entry.

**Why this priority**: Equal priority to User Story 1 — an outline that lists
headings but can't be navigated by line is not usable in a raw-mode host, which by
definition has no Lexical heading nodes to scroll to instead.

**Independent Test**: Derive entries from a markdown fixture with headings on known
lines; assert each entry's line number matches the heading's actual 1-based line in
the source text. Separately, supply a line number representing "currently visible"
and verify the outline resolves it to the correct entry as active, without any
Lexical API involved.

**Acceptance Scenarios**:

1. **Given** markdown-derived entries, **When** inspecting an entry, **Then** it
   carries a 1-based source line number matching where its heading appears in the
   input markdown.
2. **Given** markdown-derived entries and a supplied "current line", **When** that
   line falls within or after a given heading's line and before the next heading's
   line, **Then** the outline resolves and highlights that heading's entry as active.

---

### User Story 3 - WYSIWYG behavior is unaffected (Priority: P1)

As a consumer already using `DocumentOutline` with a mounted Lexical editor, I want
none of my existing behavior to change: nesting, active-entry scroll-spy tracking,
click-to-scroll, and per-instance scoping should work exactly as they do in `0.2.0`.

**Why this priority**: Equal priority — this issue must not regress the one path
that already works. It adds a second entry source; it does not replace the first.

**Independent Test**: #69's existing test suites for `DocumentOutline` and
`OutlinePlugin` continue to pass without modification to their assertions.

**Acceptance Scenarios**:

1. **Given** a mounted Lexical editor with `OutlinePlugin` feeding the handle,
   **When** the document's headings change, the reader scrolls, or an entry is
   clicked, **Then** the outline behaves exactly as specified by #69 (its FR-002
   through FR-006).

---

### Edge Cases

- Markdown with no headings → the markdown-derived path renders nothing (same as
  #69's FR-007 for the Lexical path).
- Duplicate heading titles → identity for selection/active-tracking is positional
  (by index), not by text — same rule as #69.
- Skipped heading levels (H1 → H3) and deep nesting → the markdown-derived path
  nests the same way the Lexical path does.
- Heading-like text inside code fences or inline code is not treated as a heading —
  this falls out of `parseMarkdown`'s existing mdast semantics (code content isn't
  parsed into heading nodes) and needs no special handling.
- Headings deeper than H5 → excluded on the markdown-derived path too, matching the
  existing `OutlineEntry.level` type and #69's H1–H5 assumption.
- No "current line" has been supplied yet for a raw-mode host (e.g., before first
  scroll) → the active entry is `null`, the same shape as "no active heading" on the
  WYSIWYG path.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package MUST provide a way to derive `OutlineEntry` entries from a
  markdown string alone — i.e., without any Lexical editor mounted or
  `OutlinePlugin` running.
- **FR-002**: Markdown-derived entries MUST use the same heading-detection and
  text-extraction rules as the existing Lexical path: H1–H5, in document order,
  nested by level, with heading text reduced from inline content (including inline
  code) using this package's own markdown parser (`parseMarkdown`, `isHeading`,
  `isText`, `isInlineCode`).
- **FR-003**: Every markdown-derived entry MUST carry a 1-based source line number
  identifying where its heading appears in the input markdown, matching mdast's
  `position.start.line`.
- **FR-004**: `OutlineEntry` MUST be able to carry a line number regardless of which
  path produced it. The Lexical/live-editor path is not required to populate it,
  since Lexical state has no source-line mapping to supply.
- **FR-005**: The existing Lexical-derived (WYSIWYG) behavior — heading nesting,
  scroll-spy active-tracking, click-to-scroll navigation, and per-instance handle
  scoping — MUST remain unchanged for consumers that continue to use it.
- **FR-006**: A host with only markdown and line numbers (no Lexical tree) MUST be
  able to supply the currently active line so the outline can resolve and highlight
  the corresponding active entry, giving that mode an equivalent to the Lexical
  path's scroll-spy active-tracking (#69 FR-004).
- **FR-007**: The markdown-derived path MUST render nothing when the source markdown
  has no headings, mirroring #69's FR-007 for the Lexical path.
- **FR-008**: liminis-app's raw mode (liminis#1022) MUST be able to adopt the
  markdown-derived path for its outline without maintaining a fork of the
  outline/table-of-contents logic it previously had before extraction.

### Key Entities

- **OutlineEntry**: gains a line field carrying the 1-based source line of the
  heading. Existing fields (`index`, `level`, `text`) are unchanged in meaning;
  identity for selection and active-tracking continues to be positional (`index`),
  not `text`.
- **Markdown entry source**: a way to derive `OutlineEntry[]` from a raw markdown
  string, independent of any Lexical editor state. The exact API shape this takes
  (an extension to the existing handle, a prop on `DocumentOutline`, or otherwise) is
  a Plan-stage decision — see Assumptions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A consumer can produce a populated document outline from a markdown
  string with zero Lexical editor instances mounted anywhere in the tree, verified
  by an automated test.
- **SC-002**: Every entry derived from markdown carries a source line number that
  matches the heading's actual line in the input markdown.
- **SC-003**: All of #69's existing WYSIWYG-path acceptance criteria (its
  SC-001–SC-004) continue to hold unmodified for consumers using the Lexical-derived
  path.
- **SC-004**: liminis-app can wire its raw-mode outline (liminis#1022) to the
  markdown-derived path from this package without re-implementing heading-derivation
  or line-mapping logic itself.

## Assumptions

- Heading levels stay H1–H5 for the markdown-derived path too, matching the existing
  `OutlineEntry.level` type and #69's own H1–H5 assumption for the Lexical path.
- The exact API by which markdown reaches the outline — e.g.
  `createDocumentOutlineHandle()` gaining a way to be fed markdown, vs.
  `DocumentOutline` accepting markdown directly and deriving its own entries — is a
  Plan-stage decision. This spec requires only that the capability exist (FR-001),
  not its shape.
- Whether markdown becomes the entry source for the WYSIWYG path too (replacing the
  live-Lexical derivation, and giving up the "no second parse" property #69 valued),
  or remains an alternative source used only when no Lexical editor is mounted, is a
  Plan-stage decision. This spec requires only that WYSIWYG behavior is unaffected
  either way (FR-005).
- Whether `scrollToHeading` gains a line-based counterpart, or a raw-mode host
  instead uses `entry.line` directly against its own (non-Lexical) editor to
  navigate, is a Plan-stage decision. This spec requires only that a raw-mode host
  can resolve and highlight the active entry from a supplied line (FR-006).
- Scroll-spy computation for raw mode — deciding which line is "at the top" as the
  reader scrolls — remains the host's responsibility, as it does today for that
  mode's `rawFirstVisibleLine`-style tracking. The package's job is to turn a
  supplied line into the corresponding active entry (FR-006), not to observe the raw
  editor's scroll position itself, since the package does not own that editor.

## Out of Scope

- Any change to liminis-app's `RawMarkdownEditor` or its raw-mode scroll listener —
  this issue delivers the package-side capability liminis#1022 will wire up, not the
  wiring itself.
- Deciding the specific API shape for feeding markdown into the outline, or for
  raw-mode navigation — Plan-stage decisions (see Assumptions).
- Reconciling live Lexical state and markdown-derived state when both are
  simultaneously available in the same editor instance, beyond "WYSIWYG behavior is
  unchanged" (FR-005).
- Support for heading levels beyond H5.

## Source References

- `specs/69-extract-the-table-of/spec.md` — the extraction spec whose WYSIWYG-only
  assumption this issue lifts, and whose FR/SC numbering this spec cross-references.
- `src/app/editor/documentOutlineHandle.ts`, `DocumentOutline.tsx`,
  `OutlinePlugin.tsx` — the current Lexical-only implementation.
- `src/markdown.ts`, `src/markdown/parse.ts` — the package's own markdown parser
  (`parseMarkdown`, `isHeading`, `isText`, `isInlineCode`) already used by the app's
  pre-extraction `TableOfContents.tsx`.
- liminis-app's `TableOfContents.tsx` (external repo) — the pre-extraction
  implementation this issue restores raw-mode parity with.
- verveguy/liminis#1022 (external repo) — the consumer blocked on this issue.

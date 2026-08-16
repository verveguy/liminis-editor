# Feature Specification: Multi-paragraph blockquote collapses to one paragraph, joined without a space

**Feature Branch**: `fabrik/issue-18`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "A blockquote containing two paragraphs collapses into one on round-trip, and the two are concatenated with no separating space."

## Background

A blockquote containing two paragraphs collapses into one on round-trip, and the two
paragraphs are concatenated with **no separating space**:

```markdown
> First paragraph.
>
> Second paragraph.
```

round-trips to:

```markdown
> First paragraph.Second paragraph.
```

Two losses in one: the paragraph break, and the space at the join — `.Second` rather
than `. Second`.

The same content round-trips correctly in every other container checked:

| container | result |
|---|---|
| plain paragraph | fine |
| list item | fine |
| blockquote, single paragraph | fine |
| **blockquote, two paragraphs** | **collapses, no space** |

So the fault is specific to multi-paragraph children of a blockquote, not to paragraph
serialization generally. A callout (`> [!NOTE]`) has a *different* space-loss fault,
already filed separately as #19 — they may share a cause in how quote-like containers
flush their children, but they reproduce independently and are tracked separately.

Multi-paragraph quotations are ordinary in any document that quotes a source at length,
so this is not an exotic shape. The words run together, making the damage visible, but
it is silent at save time and unrecoverable once saved — a user who opens and saves a
note containing a multi-paragraph quotation loses the paragraph break permanently.

This was found by round-tripping `examples/shared/all-the-things.md` (#15).
[#897](https://github.com/verveguy/liminis/issues/897) fixed an analogous collapse for
**list items** (a Lexical `QuoteNode`/`ListItemNode` with multiple paragraph children
collapsing to one on export, text run together) via a dedicated
`ListItemParagraphBreakNode` marker; its fixtures under
`src/app/mapper/__tests__/fixtures/roundtrip/897-list-item-block-content/` are a useful
reference for the fixture shapes worth covering here (nested lists, fenced code blocks,
tables, mixed affected/unaffected siblings).

Two existing fixtures in this repository's round-trip corpus already document closely
related symptoms under `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/`:

- **`other-blockquote-list-content-lost`**: `> Steps to reproduce:` followed by a quoted
  bullet list round-trips to the lead-in paragraph alone — the list is dropped entirely.
  This is exactly the "nested list inside a blockquote" shape this issue's acceptance
  criteria requires to survive.
- **`other-nested-blockquote-paragraph-collapse`**: `> Outer quote`, a nested `> > Nested
  quote`, then `> Back to outer` round-trips to `> Outer quoteBack to outer` followed by
  a separated `> Nested quote` — the same concatenation-without-space symptom this issue
  describes, but with a nested blockquote sitting between the two paragraphs rather than
  a second plain paragraph.

Both are noted here as directly relevant prior art for whoever researches and fixes this
issue (see Assumptions and Out of Scope for how they relate to this issue's scope).

**Reopened 2026-08-16.** The defect is confirmed still live on `main` (re-verified at
`c0244ba`, unchanged from the reproduction above). This spec was already implemented in
full on this branch and submitted as
[PR #26](https://github.com/verveguy/liminis-editor/pull/26) — mapper changes in both
`lexicalToMdast.ts` and `mdastToLexical.ts`, the `18-*` fixtures, and the
`known-defects/other-blockquote-*` promotions this spec's FR-007a anticipates — but that
PR was closed without merging and the issue was closed anyway. Branch `fabrik/issue-18`
still carries all of that work; it has simply fallen behind `main`, which has advanced
by several commits since the branch's last sync (including #17's escape-split work) and
needs reconciling before the existing fix can land. This spec is unchanged from the
version PR #26 was implemented against — the work it describes does not need to be
redone, only rebased, re-verified against current `main`, and re-landed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A two-paragraph quotation survives being opened and saved (Priority: P1)

A user pastes or writes a blockquote containing two paragraphs — a common shape when
quoting a source passage at length. They open the note in the editor and save it (with
or without making any change). Both paragraphs, and the blank line separating them,
survive exactly as written. Saving again produces a byte-identical file.

**Why this priority**: This is silent, unrecoverable data corruption of ordinary user
content on what may be a no-op edit. It affects any document that quotes more than one
paragraph from a source.

**Independent Test**: Round-trip the fixture from the Background section through the
editor's Markdown pipeline (`parseMarkdown → importMarkdownToLexical →
exportLexicalToMdast → stringifyMarkdown`) and assert the output is byte-identical to
the input, then assert a second round trip of that output is a fixed point.

**Acceptance Scenarios**:

1. **Given** a blockquote containing exactly two paragraphs separated by a blank quoted
   line, **When** it is round-tripped through the editor's Markdown pipeline, **Then**
   the output is byte-identical to the input — two separate paragraphs, each still
   prefixed with `>`, separated by a blank `>` line, with no text concatenated across
   the paragraph boundary.
2. **Given** the output of that round trip, **When** it is round-tripped a second time,
   **Then** the result is identical to the first pass (fixed point).

---

### User Story 2 - Three or more paragraphs in a blockquote survive (Priority: P1)

A user writes a blockquote containing three or more paragraphs (a longer quotation).
Every paragraph and every boundary between them survives round-tripping, not just the
first pair.

**Why this priority**: The two-paragraph case is the minimal reproduction, but the
underlying defect is a boundary-marking or child-flushing problem that a fix scoped only
to "exactly two paragraphs" could fail to generalize. This story exists so the fix is
validated beyond the minimal case, per the issue's explicit acceptance criteria.

**Independent Test**: Round-trip a blockquote fixture with three (or more) paragraphs and
assert byte-identical output and a second-pass fixed point.

**Acceptance Scenarios**:

1. **Given** a blockquote containing three paragraphs, each separated by a blank quoted
   line, **When** it is round-tripped, **Then** all three paragraphs and both boundaries
   between them survive, byte-identical to the input.

---

### User Story 3 - Other block content inside a multi-block blockquote survives (Priority: P1)

A user writes a blockquote that mixes paragraphs with other block-level content — a
quoted list, or a quoted fenced code block — rather than paragraphs alone. That content
survives round-tripping intact, not dropped and not merged into surrounding paragraph
text.

**Why this priority**: The issue's acceptance criteria explicitly require this, and one
of the two closely related existing `known-defects` fixtures
(`other-blockquote-list-content-lost`) shows a nested list inside a blockquote being
**dropped entirely** today — a strictly worse failure than the paragraph-concatenation
symptom, discovered by the same round-tripping effort that found this issue and worth
fixing under the same root cause if that's where investigation leads.

**Independent Test**: Round-trip fixtures combining a blockquote's paragraph children
with (a) a nested list and (b) a fenced code block, and assert byte-identical output and
a second-pass fixed point for each.

**Acceptance Scenarios**:

1. **Given** a blockquote containing a paragraph followed by a nested unordered or
   ordered list, **When** it is round-tripped, **Then** the list survives with its items
   intact, not dropped and not merged into the paragraph.
2. **Given** a blockquote containing a paragraph followed by a fenced code block,
   **When** it is round-tripped, **Then** the code block survives with its content and
   fence markers intact.

---

### Edge Cases

- Exactly two paragraphs (the minimal reproduction from the issue body).
- Three or more paragraphs in one blockquote.
- A nested list combined with paragraph siblings in the same blockquote.
- A fenced code block combined with paragraph siblings in the same blockquote.
- A mix of affected (multi-block) and unaffected (single-paragraph) blockquotes appearing
  near each other in the same document, confirming the fix doesn't alter the
  already-correct single-paragraph case.
- A blockquote containing exactly one paragraph — the existing, already-correct case —
  must continue to round-trip unaffected (regression guard; see FR-005).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A blockquote whose children include two or more paragraphs MUST serialize
  to Markdown as multiple separate `>`-prefixed paragraphs, separated by a blank `>`
  line — not collapsed into a single paragraph.
- **FR-002**: Text from adjacent paragraphs inside a blockquote MUST NOT be concatenated
  across the paragraph boundary without an intervening paragraph break under any
  circumstance (this rules out a partial fix that restores the break but not the space,
  or vice versa).
- **FR-003**: FR-001 and FR-002 MUST hold for three or more paragraphs in a single
  blockquote, not only for the minimal two-paragraph case.
- **FR-004**: Other block-level content nested inside a blockquote alongside paragraph
  siblings MUST be preserved on round trip — at minimum, a nested list (items intact) and
  a fenced code block (content and fence markers intact) — not dropped and not merged
  into adjacent paragraph text.
- **FR-005**: A blockquote containing exactly one paragraph (today's already-correct
  case) MUST continue to round-trip unaffected by this fix.
- **FR-006**: The round-trip pipeline (`parseMarkdown → importMarkdownToLexical →
  exportLexicalToMdast → stringifyMarkdown`) MUST reach a fixed point on a second pass
  for every fixture added under this issue.
- **FR-007**: New fixtures MUST be added to the package's round-trip fixture corpus
  (`src/app/mapper/__tests__/fixtures/roundtrip/`) covering, at minimum: the two-paragraph
  fixture from the issue body, a three-or-more-paragraph blockquote, a blockquote
  combining a paragraph with a nested list, and a blockquote combining a paragraph with a
  fenced code block.
  - **FR-007a**: If the fix resolves `known-defects/other-blockquote-list-content-lost`
    (the "nested list inside a blockquote" shape called out in User Story 3), that
    fixture MUST be promoted in place — its `.expected.md` sidecar removed once the
    fixture round-trips byte-identical — rather than left stale or duplicated under a new
    name, per this corpus's existing `897-*`/`903-*` precedent (see the corpus `README.md`).
- **FR-008**: No public API of the package may change; Markdown parsing and
  stringification behaviour outside the described defect MUST be unaffected.
- **FR-009**: No existing round-trip fixture may be added, removed, or altered other than
  the new cases required by FR-007 and the promotion permitted by FR-007a, and no
  fixture currently classified as a known defect may change classification except as
  described in FR-007a.

### Key Entities

- **Round-trip fixture**: a Markdown file in the package's round-trip corpus
  (`src/app/mapper/__tests__/fixtures/roundtrip/`), optionally paired with an
  `.expected.md` (normalized output) and/or an `.idempotence-exempt.txt` sidecar.
  Fixtures under `known-defects/` record round-trip behaviour currently accepted as
  broken.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The two-paragraph fixture from the issue body round-trips byte-identical to
  its input and is a fixed point on a second pass.
- **SC-002**: A three-or-more-paragraph blockquote fixture round-trips byte-identical and
  reaches a fixed point.
- **SC-003**: A blockquote combining a paragraph with a nested list, and a blockquote
  combining a paragraph with a fenced code block, each round-trip byte-identical (content
  preserved, not merely stable) and reach a fixed point.
- **SC-004**: The existing round-trip fixture corpus continues to pass unchanged, except
  for the new fixtures required by FR-007 and any promotion permitted by FR-007a.
- **SC-005**: The full package test suite plus `pnpm typecheck && pnpm lint && pnpm build
  && pnpm test` pass.

## Assumptions

- The fix is confined to the Markdown import/export mapper layer (mirrors #897's
  approach for list items); no change to the Markdown parser or stringifier library
  itself is assumed to be required. Research/Plan determine the actual mechanism.
- New fixtures follow this corpus's issue-number naming convention (i.e. `18-*`), except
  where FR-007a directs promoting an existing `known-defects/` fixture in place instead.
- `known-defects/other-nested-blockquote-paragraph-collapse` (a nested blockquote
  interspersed between two paragraphs, rather than a second plain paragraph) is closely
  related — same concatenation-without-space symptom — but is **not** part of this
  issue's required scope: the issue's own reproduction and scope table cover plain
  paragraphs and single-level blockquotes only, not blockquote-in-blockquote nesting. If
  the fix happens to resolve it too, promote it per the FR-007a pattern; if not, it
  remains a known defect for separate follow-up. Either outcome satisfies this spec.
- The callout (`> [!NOTE]`) space-loss defect (#19) is a separate issue and is not
  addressed here, per the issue body's own scope note.

## Out of Scope

- The callout (`> [!NOTE]`) first-line space-loss defect — filed separately as #19.
- Resolving `known-defects/other-nested-blockquote-paragraph-collapse` (nested
  blockquote-in-blockquote) is not required by this issue; see Assumptions.
- Block content types not named in the acceptance criteria (e.g. quoted tables,
  definition lists, HTML blocks, further-nested blockquotes) — not required here, though
  a fix that happens to generalize to them is not precluded.
- Migration or repair of documents already corrupted by this defect before the fix lands.
- Editor UI or keybinding behaviour beyond serialization correctness.

## Source References

- `src/app/mapper/lexicalToMdast.ts` — `convertQuoteNode` and related blockquote export
  logic.
- `src/app/mapper/mdastToLexical.ts` — blockquote import logic.
- `src/app/mapper/__tests__/fixtures/roundtrip/897-list-item-block-content/` — reference
  fixture shapes for the analogous list-item fix (#897): nested lists, fenced code
  blocks, tables, mixed affected/unaffected siblings.
- `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/other-blockquote-list-content-lost.md`
  and its `.expected.md` — existing fixture for User Story 3's nested-list shape.
- `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/other-nested-blockquote-paragraph-collapse.md`
  and its `.expected.md` — existing fixture for the related but out-of-scope nested-quote
  shape (see Assumptions).
- `src/app/mapper/__tests__/fixtures/roundtrip/README.md` — round-trip corpus conventions
  (`.expected.md`, `.idempotence-exempt.txt`, `known-defects/` promotion pattern).
- `examples/shared/all-the-things.md` (#15) — the document whose round-tripping surfaced
  this issue.
- Liminis issue #897 — analogous multi-paragraph collapse fix for list items, the
  reference implementation pattern for this issue.
- [PR #26](https://github.com/verveguy/liminis-editor/pull/26) (closed, unmerged) — the
  previous implementation of this spec; `fabrik/issue-18` still carries its commits and
  needs rebasing onto current `main` rather than reimplementation.

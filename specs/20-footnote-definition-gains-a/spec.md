# Feature Specification: Footnote definition gains a doubled space after the colon on round-trip

**Feature Branch**: `fabrik/issue-20`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "A footnote definition gains an extra space after its colon on every round-trip. `[^1]: The note.` round-trips to `[^1]:  The note.` — one space becomes two. There is also a second, unconfirmed behaviour: round-tripping `examples/shared/all-the-things.md` (#15), which has its definitions in a `## Footnotes` section partway through the document, the definitions were relocated to the very end of the document. A minimal fixture with the footnote definition already at the end did not reproduce the move — only the spacing — so the two may be separate, or relocation may depend on what follows the definitions."

## Background

Every time a document containing a footnote definition is opened and saved (with no
edit), the definition's leading space after its colon doubles: `[^1]: The note.`
becomes `[^1]:  The note.` No text is lost and rendered output is unchanged, but the
document is not stable under a no-op save, and the extra space compounds visually the
more a document is round-tripped in some editors' rendering. This is lower severity
than issues #16, #18 and #19, but it is still an unwanted diff on every save.

This defect is already present, and already silently accepted, in this repository's
own round-trip fixture corpus (`src/app/mapper/__tests__/fixtures/roundtrip/`):
`footnotes.md` and `link-with-footnote-reference.md` both carry an `.expected.md`
sidecar whose only difference from the input is the doubled space, and the corpus's
own `README.md` names it explicitly as "an extra space already present on
`footnotes.md` and `link-with-footnote-reference.md`" that a prior issue (#908, which
fixed a different footnote defect — markers not wrapping around footnote nodes)
deliberately did not touch. Three further fixtures
(`known-defects/other-emphasis-footnote-not-wrapped.md`, `emphasis-footnote-only.md`,
`strong-mixed-text-math-footnote.md`) carry the same pre-existing spacing diff in their
`.expected.md` sidecars for the same reason. This issue is the one that does touch it.

A second, unconfirmed behaviour was reported alongside the spacing defect: round-tripping
`examples/shared/all-the-things.md` — a large kitchen-sink fixture added by issue #15,
which groups its footnote definitions under a `## Footnotes` heading partway through the
document rather than at the very end — moved those definitions to the end of the
document on round-trip. A minimal fixture with the definition already positioned at the
end of the document (the shape every existing corpus fixture uses) did not reproduce
this move, only the spacing change. So relocation may be a distinct defect from the
spacing one, or it may only manifest when a footnote definition is followed by further
block-level content. **Note**: `examples/shared/all-the-things.md` does not exist in
this repository yet — #15 is still open — so the relocation question cannot be
diagnosed against that file directly and needs its own minimal fixture that reproduces
the relevant shape (a footnote definition followed by more content).

Moving definitions to the end of a document is a defensible normalisation on its own.
Doing it silently, and coupled with a spacing change, is not: an author who groups
footnotes under a heading (as `all-the-things.md` does) would find that heading left
with nothing beneath it, with no indication the tool did this.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Footnote definition round-trips without gaining a space (Priority: P1)

An author writes a note containing a footnote reference and its definition
(`[^1]: The note.`). They open the note in the Liminis editor and save it, with or
without making any change. The definition's spacing is preserved exactly as written,
and saving again does not change it further.

**Why this priority**: This is the concretely reported, always-reproducing defect. It
affects every document containing a footnote definition and compounds with each save.

**Independent Test**: Round-trip the issue's minimal fixture (a paragraph referencing
`[^1]`, a blank line, `[^1]: The note.`, a `## After` heading, and a trailing
paragraph) through `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast →
stringifyMarkdown` twice and assert both the first pass matches the input byte-for-byte
and the second pass matches the first.

**Acceptance Scenarios**:

1. **Given** a document containing `[^1]: The note.`, **When** it is round-tripped
   through the editor's Markdown pipeline, **Then** the output contains exactly one
   space between the colon and the note text.
2. **Given** the output of that first round-trip, **When** it is round-tripped a second
   time, **Then** the result is identical to the first pass (fixed point).
3. **Given** the issue's minimal reproduction fixture (footnote reference, definition,
   a subsequent `## After` heading, and trailing prose), **When** it is round-tripped,
   **Then** the output is byte-identical to the input.

---

### User Story 2 - Footnote definition relocation is diagnosed and resolved (Priority: P1)

A maintainer needs to know, with certainty, whether saving a document with a footnote
definition positioned earlier in the document (followed by more headings and content)
moves that definition to the end of the document. Today this is observed only
indirectly, via a large fixture (#15's `all-the-things.md`) that is not yet available
in this repository, and is not reproduced by any existing minimal fixture.

**Why this priority**: If relocation is real, it is a structural change to document
content, not a cosmetic spacing normalisation, and is more serious than User Story 1.
The issue cannot be considered resolved without an explicit, test-backed answer either
way.

**Independent Test**: Construct a minimal fixture with a footnote reference, its
definition positioned mid-document, and further block-level content (e.g. a heading and
a paragraph) after the definition. Round-trip it and inspect whether the definition's
document position changed.

**Acceptance Scenarios**:

1. **Given** a document with a footnote definition followed by a heading and further
   prose, **When** it is round-tripped, **Then** the definition's position in the
   output is deterministically established by a fixture — either byte-identical
   (relocation does not occur) or captured in an `.expected.md` sidecar with an
   explanation (relocation occurs and is treated as an intentional, documented
   normalisation).
2. **Given** relocation is found to occur, **When** the fix for User Story 1 is
   applied, **Then** the relocated output still contains only a single space after the
   footnote definition's colon (the two defects do not compound).
3. **Given** relocation is found not to occur, **When** the fix for User Story 1 is
   applied, **Then** a fixture pins that a footnote definition followed by further
   content keeps its original document position.

---

### User Story 3 - Multiple and named footnote definitions are covered (Priority: P2)

A document contains more than one footnote definition, and/or a definition uses a
named label (e.g. `[^note]:`) rather than a bare number. These round-trip with the
same fidelity as the single-numeric-footnote case.

**Why this priority**: Confirms the fix generalises beyond the single-numeric-footnote
shape the issue's minimal repro uses, without which the fix could be shape-specific and
regress on real documents (which mix numeric and named footnotes freely).

**Independent Test**: A fixture with two or more footnote definitions, and a fixture
with at least one named (non-numeric) footnote label, each round-tripped and checked
for byte-identity and fixed-point stability.

**Acceptance Scenarios**:

1. **Given** a document with two or more footnote definitions, **When** it is
   round-tripped twice, **Then** every definition keeps exactly one space after its
   colon and the result is a fixed point.
2. **Given** a document with a named footnote definition (`[^note]: ...`), **When** it
   is round-tripped twice, **Then** the label and spacing are preserved and the result
   is a fixed point.

---

### Edge Cases

- A footnote definition immediately followed by another block-level element (a heading,
  a paragraph) with no footnote-definition-only region between them and the end of the
  document — the shape that reportedly triggers relocation.
- A document with multiple footnote definitions where only some are followed by further
  content.
- A named footnote definition (`[^note]:`) alongside a numeric one (`[^1]:`) in the same
  document.
- If relocation is confirmed and treated as intentional, a heading (e.g. `## Footnotes`)
  that contained only footnote definitions and is left with no body content after they
  move.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A footnote definition's colon-to-body separator MUST round-trip as
  exactly one space when the source used exactly one space, for both numeric
  (`[^1]:`) and named (`[^note]:`) labels.
- **FR-002**: A document containing one or more footnote definitions MUST reach a fixed
  point on a second round-trip pass (second-pass output byte-identical to first-pass
  output).
- **FR-003**: The existing round-trip corpus fixtures whose `.expected.md` sidecar
  exists solely to pin the doubled-space defect (`footnotes.md`,
  `link-with-footnote-reference.md`, `known-defects/other-emphasis-footnote-not-
  wrapped.md`, `emphasis-footnote-only.md`, `strong-mixed-text-math-footnote.md`) MUST
  be re-evaluated once the defect is fixed: each becomes byte-identical to its input
  (sidecar removed) unless a documented, unrelated normalisation still applies.
- **FR-004**: Whether a footnote definition positioned earlier in a document (followed
  by further block-level content) is relocated to the end of the document on
  round-trip MUST be explicitly determined, via a new minimal fixture reproducing that
  shape — not inferred from the unavailable `all-the-things.md` file.
- **FR-005**: If relocation is found not to occur, a fixture MUST pin that the
  definition's position is preserved (byte-identical round-trip).
- **FR-006**: If relocation is found to occur, it MUST NOT be left as an undocumented
  side effect: it MUST be captured via an `.expected.md` fixture together with a
  written explanation of why it happens and that it is being treated as an accepted
  normalisation, consistent with this corpus's existing convention for documented
  normalisations (see e.g. the `50-*` fixture set's blank-line canonicalisation).
- **FR-007**: If relocation is found to occur, its output MUST NOT also carry the
  doubled-space defect (FR-001) — the two must not compound into a worse result than
  either alone.
- **FR-008**: New fixture coverage MUST include a document with multiple footnote
  definitions and a document with at least one named (non-numeric) footnote label.

### Key Entities

- **Footnote definition**: The `[^label]: body` block-level markdown construct that
  supplies the text for a footnote reference (`[^label]`) used elsewhere in the
  document. This issue concerns only the definition's own serialization (spacing and
  document position) — not the inline reference marker, which already round-trips
  correctly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The issue's minimal reproduction fixture round-trips byte-identical to
  its input and is a fixed point on a second pass.
- **SC-002**: The relocation question has an explicit, test-backed answer recorded in
  the PR: either a fixture proving footnote definitions are never relocated, or a
  fixture plus documentation showing relocation is an intentional, pinned
  normalisation.
- **SC-003**: Every pre-existing round-trip corpus fixture that carried the
  doubled-space defect in its `.expected.md` sidecar is updated to reflect the fixed
  behaviour (sidecar removed, or updated if an unrelated normalisation remains), and
  the full corpus suite passes.
- **SC-004**: New fixtures cover multiple footnote definitions in one document and at
  least one named (non-numeric) footnote label, both round-tripping byte-identical and
  reaching a fixed point.

## Assumptions

- The doubled-space defect and the possible relocation behaviour are both scoped to
  footnote *definitions* specifically. Footnote *references* (the inline `[^1]` marker
  in prose) already round-trip correctly per the existing corpus and are not part of
  this issue.
- `examples/shared/all-the-things.md` (added by the still-open issue #15) is not
  present in this repository. The relocation question must be settled with a new,
  minimal, purpose-built fixture rather than by depending on that file.
- Fixing the spacing defect and resolving the relocation question may turn out to
  share a root cause or may be independent — the issue explicitly leaves this open,
  and both User Story 1 and User Story 2 must be verified independently regardless of
  which turns out to be true.

## Out of Scope

- General footnote body content formatting changes unrelated to the definition's
  leading spacing or document position (e.g. inline formatting inside footnote bodies).
- Reopening the footnote-marker-wrapping behaviour fixed by #908 (bold/italic/footnote
  nesting) — unaffected by this issue.
- Changes to how footnote *references* are serialized.
- Adding `examples/shared/all-the-things.md` itself — tracked separately by #15.

## Source References

- `src/app/mapper/__tests__/fixtures/roundtrip/footnotes.md` /
  `footnotes.expected.md` — currently pins the doubled-space defect as accepted output.
- `src/app/mapper/__tests__/fixtures/roundtrip/link-with-footnote-reference.md` /
  `.expected.md` — same defect, different surrounding construct (a link containing a
  footnote reference).
- `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/other-emphasis-footnote-
  not-wrapped.md`, `emphasis-footnote-only.md`, `strong-mixed-text-math-footnote.md` —
  each carries the same pre-existing spacing diff in its `.expected.md` sidecar,
  called out by name in the corpus README as unrelated to the issue (#908) that added
  them.
- `src/app/mapper/__tests__/fixtures/roundtrip/README.md` — documents the corpus's
  fixture conventions (`.expected.md` sidecars, `known-defects/`, idempotence
  exemptions) that this issue's fixtures must follow, and explicitly names the
  doubled-space defect as pre-existing and out of scope for the issue that last
  touched these files.
- Issue #15 (`examples: add a shared "All The Things" sample document to both shells`)
  — original discovery of both the spacing defect and the relocation behaviour, found
  while round-tripping a large kitchen-sink fixture not yet present in this
  repository.

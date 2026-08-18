# Feature Specification: Preserve conventional GFM table delimiter width on serialization

**Feature Branch**: `fabrik/issue-60`
**Created**: 2026-08-17
**Status**: Specified
**Input**: User description: "`stringifyMarkdown` (the mdast → markdown path used by `exportLexicalToMdast` + `stringifyMarkdown`) renders every GFM table delimiter row cell as a single hyphen. Any table authored with the conventional three-hyphen delimiter — or with width-padded hyphens — is rewritten on the first serialize, producing a spurious one-line diff even when the user changed nothing."

## Background

`stringifyMarkdown` renders every GFM table delimiter-row cell down to the minimum legal form: a bare `-` (or `:-`, `:-:`, `-:` with alignment colons), regardless of how the source table was written. Column alignment survives this — it is read from the Lexical `TableCellNode`'s `format` field on import and written back out on export, a fix already landed for a prior defect (#907, tracked in the `known-defects/other-table-column-alignment-lost` and `other-table-single-column-aligned` round-trip fixtures). What is missing is the hyphen *count*: the conventional three-hyphen form (`---`), the form GFM, `remark-stringify`, and Prettier all produce, is collapsed to one hyphen on every serialize.

This is cosmetic — the table still parses identically either way — but it defies the ecosystem convention and breaks byte-stable round-trip for any normally-formatted table. Concretely: a table authored as `| --- | --- |` comes back as `| - | - |`, and a table authored with width-padded delimiters (`|------|------|`) also comes back as `| - | - |`. Every case is idempotent after the first pass, but that first pass produces a diff on a document nobody actually edited.

For a git-backed review tool consuming this editor (Zusammen), that noise lands directly in review diffs — a save with no intended content change surfaces as a one-line-per-column table diff. This is the same class of problem ADR-076 addresses for other parts of the serializer ("Markdown Serialization Is a Fixed Point"): the round-trip pipeline (`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`) should not churn content a user never touched.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A conventional table survives a no-op round-trip (Priority: P1)

As a tool consuming this editor (e.g. Zusammen, reviewing diffs), I want a table authored with the standard `---` delimiter to serialize back unchanged, so that opening and saving a document with a table produces no spurious diff.

**Why this priority**: This is the entire scope of the issue. Table-containing documents are common, and every one of them currently churns on first save even when genuinely untouched — directly polluting downstream review diffs.

**Independent Test**: Round-trip a table fixture through `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` and assert the output delimiter row is byte-identical to a conventionally-formatted input.

**Acceptance Scenarios**:

1. **Given** a GFM table whose delimiter row uses the conventional three-hyphen cells (`| --- | --- |`), **When** it is round-tripped, **Then** the output delimiter row is byte-identical to the input.
2. **Given** an aligned table (`| :--- | :---: | ---: |`), **When** it is round-tripped, **Then** the alignment markers and hyphen form are preserved byte-identically.
3. **Given** any table, **When** it is round-tripped twice, **Then** the second pass equals the first (idempotence).

---

### Edge Cases

- Single-column tables (`| a |\n| --- |`).
- Empty header cells / empty body cells.
- All four alignment kinds mixed in one table.
- A table immediately adjacent to other block content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Table delimiter cells MUST serialize using the conventional GFM form of at least three hyphens per cell (`---`), rather than a single hyphen.
- **FR-002**: Column alignment MUST be preserved exactly — `:---` (left), `:---:` (center), `---:` (right), `---` (none) — matching the input's alignment for every column.
- **FR-003**: Serialization MUST be idempotent: serializing already-conventional output MUST leave it unchanged.
- **FR-004**: A table whose delimiter row is already in the conventional three-hyphen form (with or without alignment colons) MUST round-trip byte-identically.
- **FR-005**: New round-trip fixtures MUST be added to the package's existing round-trip corpus covering, at minimum: a conventional three-hyphen table, a width-padded-delimiter table, and a table exercising all four alignment kinds together — so both the dash-count fix and the pre-existing alignment-preservation behavior are guarded against regression.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A document containing a conventionally-formatted GFM table round-trips with zero delimiter-row changes.
- **SC-002**: No table's column alignment changes across a round-trip (regression guard — this holds today and must continue to).
- **SC-003**: The serializer's output for table delimiters matches what remark-stringify / Prettier produce for the same table.

## Assumptions

- Byte-exact preservation of *arbitrary* delimiter widths (e.g. keeping `|------|` as-is) is a non-goal; canonicalizing to the conventional `---` is expected and desirable, consistent with ADR-076's acceptance of one-time canonicalization in exchange for a stable fixed point.
- This is a serialization-only change; parsing and rendering are unaffected (alignment already parses correctly).

## Out of Scope

- Any change to how alignment is parsed, stored on `TableCellNode`, or rendered — that behavior is correct today and is not touched by this issue.
- Byte-exact preservation of non-conventional delimiter widths.
- The `known-defects/other-table-column-alignment-lost` and `other-table-single-column-aligned` fixtures' classification as fixed regression gates — this issue only affects their delimiter row's hyphen count, not their alignment-preservation guarantee.

## Source References

- `src/markdown/stringify.ts` — the mdast → markdown serialization path, including the `gfmToMarkdown` configuration consumed by `stringifyMarkdown`.
- `src/app/mapper/__tests__/fixtures/roundtrip/` — the round-trip fixture corpus, including `known-defects/other-table-column-alignment-lost.md` and `known-defects/other-table-single-column-aligned.md`, which already exercise the minimal-hyphen delimiter form this issue changes.
- `docs/decisions/adr-076.md` — "Markdown Serialization Is a Fixed Point," establishing the project's idempotence expectations and its tolerance for one-time canonicalization.
- Liminis issue #907 — the prior defect where table alignment itself (not hyphen count) was lost on export; fixed via the `TableCellNode` `format` field.

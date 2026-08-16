# Feature Specification: Emphasis nested inside strong is re-emitted with duplicated, unbalanced markers

**Feature Branch**: `fabrik/issue-16`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "Emphasis nested inside strong is re-emitted with duplicated, unbalanced markers. The document is corrupted on a no-op save, and worsens on each subsequent save."

## Background

Emphasis nested inside strong is ordinary prose formatting (`**bold with _italic_ inside**`) and appears throughout real documents. When such a document is round-tripped through the editor's markdown pipeline — `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` — with no edits made, the strong run is incorrectly closed and reopened around the nested emphasis, and the emphasis is additionally wrapped in its own strong markers. The re-emitted markdown does not parse back to the same tree, so the corruption compounds on every subsequent save.

This is the same class of bug as verveguy/liminis#973 (silent corruption of user content on a no-op save), which was previously fixed for the code-format case. The mergeable-format run computation in `convertInlineUnit` (`src/app/mapper/lexicalToMdast.ts`) governs how adjacent/nested formatted runs are flushed and merged when exporting from Lexical back to mdast; the same logic that was fixed for code formatting apparently does not correctly handle nested emphasis-in-strong (or the reverse nesting).

This issue is potentially related to #17 (escaped underscore dropped on export), which may share a root cause in the same run-flushing logic — but the two are tracked and fixed independently.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open and save a document with nested emphasis inside strong (Priority: P1)

A user opens a markdown document containing text like `Text with **bold and _nested italic_ inside**.` and saves it without making any edits.

**Why this priority**: This is silent data corruption on a no-op save — the most severe class of bug for an editor, since the user takes no action that would lead them to expect their content to change.

**Independent Test**: Round-trip the fixture `Text with **bold and _nested italic_ inside**.` through `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` and assert the output is byte-identical to the input.

**Acceptance Scenarios**:

1. **Given** the markdown `Text with **bold and _nested italic_ inside**.`, **When** it is round-tripped through the full pipeline with no edits, **Then** the output is byte-identical to the input.
2. **Given** the output of the first round-trip pass, **When** it is round-tripped a second time, **Then** the output is unchanged (a fixed point is reached — no further compounding corruption).
3. **Given** the markdown `Text with _italic with **bold** inside_.` (emphasis containing nested strong, the reverse nesting), **When** it is round-tripped through the full pipeline with no edits, **Then** the output is byte-identical to the input and reaches a fixed point on a second pass.

---

### Edge Cases

- The fix must not change the classification (pass/fail outcome) of any fixture already present in the round-trip corpus.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Markdown text containing emphasis nested inside strong (e.g. `**bold and _nested italic_ inside**`) MUST round-trip byte-identically through `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` with no edits made.
- **FR-002**: Markdown text containing strong nested inside emphasis (e.g. `_italic with **bold** inside_`) MUST round-trip byte-identically through the same pipeline.
- **FR-003**: Re-running the round-trip pipeline on already-canonical output (a second pass) MUST be a no-op fixed point for both nesting directions — output must not change further.
- **FR-004**: A fixture covering the nested-emphasis-in-strong case (and, per FR-002, the reverse nesting) MUST be added to the round-trip fixture corpus so future regressions are caught automatically.
- **FR-005**: The fix MUST NOT change the pass/fail classification of any fixture already present in the round-trip corpus.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The fixture `Text with **bold and _nested italic_ inside**.` round-trips byte-identically and reaches a fixed point on a second pass.
- **SC-002**: The fixture `Text with _italic with **bold** inside_.` (reverse nesting) round-trips byte-identically and reaches a fixed point on a second pass.
- **SC-003**: The full round-trip fixture corpus passes with no classification changes to any pre-existing fixture.

## Assumptions

- The fix lives in (or near) the mergeable-format run computation in `convertInlineUnit` in `src/app/mapper/lexicalToMdast.ts`, per the issue notes, but the exact root cause and fix location are for the Research/Plan stages to determine.
- Only the two nesting combinations described above (emphasis-in-strong and strong-in-emphasis) are in scope for this issue's acceptance criteria; other mark-nesting combinations (e.g. strikethrough nested in strong/emphasis) are not required to be fixed here, though a fix that happens to also correct them is not a problem.
- The related issue #17 (escaped underscore dropped) is tracked and fixed separately, even if it shares underlying logic.

## Out of Scope

- Fixing #17 (escaped underscore dropped on export) — tracked separately.
- Any mark-nesting combination other than emphasis-in-strong and strong-in-emphasis.

## Source References

- `src/app/mapper/lexicalToMdast.ts` — `convertInlineUnit` / mergeable-format run computation, where #973 was previously fixed for the code-format case.
- `src/app/mapper/__tests__/fixture-roundtrip.test.ts` and `src/app/mapper/__tests__/roundtrip-test-utils.ts` — the round-trip fixture corpus harness; fixtures live under `src/app/mapper/__tests__/fixtures/roundtrip/`.
- verveguy/liminis#973 — prior fix for the same class of no-op-save corruption (code-format case).
- #17 — related, possibly shared root cause in run-flushing logic (escaped underscore dropped).
- #15 — `examples/shared/all-the-things.md`, the corpus fixture whose round-trip surfaced this bug.

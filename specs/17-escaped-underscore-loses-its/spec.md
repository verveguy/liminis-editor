# Feature Specification: Backslash-escaped punctuation loses its escape on round-trip

**Feature Branch**: `fabrik/issue-17`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "A backslash-escaped underscore loses its escape on round-trip. The escaped asterisk does not — the two are handled differently."

## Background

Liminis's markdown pipeline (`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast →
stringifyMarkdown`) is required to be idempotent: per ADR-076, a document's first-pass output must
be a fixed point on a second pass, and a user who opens and saves a file without editing it must get
back byte-identical content.

A backslash-escaped underscore breaks this guarantee. Given:

```markdown
A backslash\_underscore and a literal \*star\*.
```

the round-trip produces:

```markdown
A backslash_underscore and a literal \*star\*.
```

The `\_` loses its backslash while the `\*` on the same line does not — the two escapes are handled
asymmetrically somewhere in the pipeline.

This is not a cosmetic diff. The backslash exists to stop `_` from being read as an emphasis
delimiter. Dropping it doesn't change what today's document displays, but it changes what the
document *means* on the next parse: `backslash_underscore` reads as one literal word today, but the
moment a second underscore appears anywhere later on the same line, CommonMark may read the pair as
an emphasis span. The user wrote the escape specifically to prevent that. Removing it on a silent,
no-edit save is the same failure class as issue #973 (markdown serializer non-idempotence around
emphasis/inline-code): no edit was made, content was altered, and the damage is latent rather than
visible at save time.

The defect was found while round-tripping a shared example fixture (`examples/shared/all-the-things.md`,
tracked by issue #15) that exercises a broad mix of markdown constructs. The asymmetry between `\_`
and `\*` is the clue that whatever logic preserves the asterisk's escape is not being applied
consistently to other escapable characters, so this spec treats the fix as a general escaping
correctness problem rather than a narrow underscore-only patch. It may share a root cause with issue
#16 (nested emphasis), since both concern how emphasis delimiters are decided at serialize time — but
that overlap, if any, is for Research to determine; this spec does not assume it and does not require
#16 to be fixed here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Escaped punctuation survives an open-and-save cycle (Priority: P1)

A user writes prose containing backslash-escaped punctuation that would otherwise be reinterpreted by
Markdown (e.g. `backslash\_underscore`, `\*star\*`, `` \`literal backticks\` ``, `\[not a link\]`,
`\# not a heading`, a literal backslash `\\`). They open the document in the Liminis editor and save
it without making any change. The escapes are preserved exactly as written, both in the editor's
round-trip and in the Markdown file on disk. Saving again produces a byte-identical file.

**Why this priority**: This is silent, no-edit data corruption. A dropped escape doesn't just alter
bytes — it changes how the content will be parsed the next time an adjacent character changes,
turning a latent risk into a visible formatting bug well after the user has forgotten they ever
touched the file.

**Independent Test**: Round-trip a fixture containing escaped punctuation through
`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` and assert the
output is byte-identical to the input. Round-trip the output a second time and assert it equals the
first-pass output (fixed point), per the existing corpus convention (ADR-076).

**Acceptance Scenarios**:

1. **Given** the document `A backslash\_underscore and a literal \*star\*.`, **When** it is
   round-tripped through the editor's Markdown pipeline, **Then** the output is byte-identical to the
   input (both escapes preserved).
2. **Given** the output of that round-trip, **When** it is round-tripped a second time, **Then** the
   result is identical to the first pass (fixed point).
3. **Given** a document containing a backslash-escaped instance of each of `*`, `_`, `` ` ``, `[`,
   `]`, `#`, and `\` in a context where the escape is meaningful (i.e., the unescaped character would
   be reinterpreted by CommonMark), **When** it is round-tripped, **Then** each escape is preserved
   byte-for-byte and the result is a fixed point on a second pass.

---

### Edge Cases

- A literal backslash immediately followed by another escapable character (e.g. `\\_` — an escaped
  backslash followed by a plain underscore) must not be confused with a single escaped character; the
  backslash's own escaping must be preserved independently of what follows it.
- An escaped character adjacent to other formatting (e.g. `\*` immediately next to inline code or
  another emphasis span, mirroring the adjacency conditions in issue #973) must not regress either
  defect's fix.
- A character that does not need escaping in its context (e.g. `#` in the middle of a sentence, not
  at the start of a line) must not gain a spurious backslash it didn't have — the fix must not
  over-escape as a side effect of preserving genuine escapes.
- Multiple different escaped characters within the same line or paragraph must each be preserved
  independently; fixing one must not regress another (the `\_` / `\*` asymmetry in the original report
  is itself an instance of this).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A backslash-escaped instance of any of `*`, `_`, `` ` ``, `[`, `]`, `#`, or `\`, in a
  position where the escape is meaningful (the unescaped character would otherwise be reinterpreted by
  CommonMark), MUST round-trip through the editor's Markdown pipeline with the backslash preserved.
- **FR-002**: The fix MUST NOT introduce new backslash escapes on characters that had none and do not
  require one in context — round-tripping must not over-escape as a side effect of fixing the
  under-escaping defect.
- **FR-003**: The round-trip pipeline MUST reach a fixed point on the second pass for all fixtures
  covering FR-001, consistent with the existing fixed-point guarantee (ADR-076).
- **FR-004**: New round-trip fixtures MUST be added to the package's existing round-trip corpus
  covering the reproduction case from this issue (`\_` and `\*` together on one line) and, at
  minimum, one meaningful-context case for each of `` \` ``, `\[`, `\]`, `\#`, and `\\`.
- **FR-005**: No public API of `@liminis/editor` may change; Markdown parsing and stringification
  behavior outside the described defect MUST be unaffected.
- **FR-006**: No existing round-trip fixture may be added, removed, or altered other than the new
  cases required by FR-004, and no fixture currently classified as a known defect may change
  classification, unless individually diagnosed and documented per ADR-076's exemption rule.

### Key Entities

- **Round-trip fixture**: a Markdown file in the package's round-trip corpus, optionally paired with
  an `.expected.md` (normalized output) and/or an `.idempotence-exempt.txt` sidecar, per the existing
  corpus conventions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The reproduction fixture from this issue (`A backslash\_underscore and a literal
  \*star\*.`) round-trips byte-identically and is a fixed point on a second pass.
- **SC-002**: Each of `\*`, `\_`, `` \` ``, `\[`, `\]`, `\#`, and `\\` is covered by at least one
  round-trip fixture in a context where the escape is meaningful, and each round-trips byte-identically
  with a fixed second-pass result.
- **SC-003**: The existing round-trip fixture corpus continues to pass unchanged — no fixture
  added/removed/altered other than the new cases, and no `known-defects` case flips without an
  individually documented reason.
- **SC-004**: The full package test suite plus `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  pass.

## Assumptions

- The seven characters named in the issue (`*`, `_`, `` ` ``, `[`, `]`, `#`, `\`) define this issue's
  scope. CommonMark's full escapable-punctuation set is larger; extending coverage to the remainder is
  not required here and may be handled as follow-up if Research finds it shares the same root cause.
- New fixtures follow the corpus's existing naming convention of an issue-number prefix (i.e. `17-*`).
- This issue does not require fixing issue #16 (nested emphasis). If Research finds a shared root
  cause, the two may be fixed together, but this spec's acceptance does not depend on that outcome.
- `examples/shared/all-the-things.md` (issue #15) is referenced here as the origin of the discovery,
  not as a required deliverable of this issue — this issue's fixtures live in the package's round-trip
  corpus per FR-004, independent of that example file's own status.

## Out of Scope

- CommonMark-escapable punctuation characters not named in this issue's acceptance criteria (e.g. `!`,
  `"`, `(`, `)`, etc.), unless Research determines they share this exact defect and fixing them
  incurs no additional risk.
- Issue #16 (nested emphasis handling), tracked separately.
- Issue #973 (emphasis/strong adjacent to inline code), already fixed separately.
- Repair or migration of documents already corrupted by this defect on disk.
- Editor UI or keybinding behavior; this is a serialization-correctness fix only.

## Source References

- Issue #17 reproduction: `A backslash\_underscore and a literal \*star\*.`
- `src/markdown/stringify.ts` — Markdown stringification, where the asymmetry between `\*` and `\_`
  handling is expected to live (exact site to be confirmed by Research)
- `src/app/mapper/__tests__/fixtures/roundtrip/` — round-trip fixture corpus
- `src/app/mapper/__tests__/roundtrip-test-utils.ts` — corpus harness, including `.expected.md` and
  `.idempotence-exempt.txt` sidecar handling
- `docs/decisions/adr-076.md` — fixed-point round-trip guarantee this fix must uphold
- `specs/973-markdown-serializer-non-idempotent-emphasis/spec.md` — prior spec in the same defect
  class (non-edit content alteration on save)
- Issue #15 — `examples/shared/all-the-things.md`, where this defect was discovered
- Issue #16 — nested emphasis, possible shared root cause (not required by this issue)

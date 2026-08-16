# Feature Specification: Callout round-trip loses the space before a first-line inline-formatted span

**Feature Branch**: `fabrik/issue-19`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "Inside a callout, the space immediately before an inline-formatted span is lost on round-trip."

## Background

Inside a callout (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`), the space immediately
preceding an inline-formatted span (bold, italic, inline code, strikethrough, a link) is
silently dropped on round-trip when that span appears on the callout's first content
line:

```markdown
> [!NOTE]
> This has **bold** in it.
```

round-trips to:

```markdown
> [!NOTE]
> This has**bold** in it.
```

`This has **bold**` becomes `This has**bold**` — two words are silently joined into
one. This is a no-op-save data corruption of the class described in
verveguy/liminis#973: a user who merely opens and saves a document loses content they
never touched.

The same sentence round-trips correctly in every other container the corpus tests —
plain paragraph, list item, and a plain blockquote (`>` with no `[!NOTE]` marker) are
all fine. Only the callout path is affected. A *plain* blockquote has a different,
unrelated fault (multi-paragraph collapse, filed as #18); the two reproduce
independently and are tracked separately, though they may turn out to share a root
cause in how quote-like containers flush their inline children.

The corpus already contains `callout/inline-formatting.md`, which mixes bold, italic,
and inline code inside a callout and passes today. The distinction is line position:
that fixture deliberately places its formatted text in the callout's **second**
paragraph, not its first line, specifically to avoid tripping this defect. The corpus's
`known-defects/other-callout-first-line-inline-formatting-space-lost.md` fixture
already documents the defect as reproduced, with its `.expected.md` sidecar recording
today's defective output (`> This has**bold**, _italic_, and \`inline code\`.`) —
this issue is what turns that fixture from a documented defect into a permanent
regression gate, following the precedent already established for `897-*` and `903-*`
in this same corpus.

Callouts are one of this package's bespoke constructs (introduced by #1); nothing
outside this codebase exercises them, and until `examples/shared/all-the-things.md`
(#15) there was no fixture combining a callout with first-line inline formatting, which
is why this survived undetected.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Text preceding a formatted span on a callout's first line survives a save (Priority: P1)

A user writes a callout whose first content line contains prose immediately followed by
an inline-formatted span, e.g. `> [!NOTE]` / `> This has **bold** in it.`. They open the
note in the editor and save it, with or without making any change. The space before the
formatted span is preserved exactly as written, in both the rendered editor and the
Markdown file on disk. Saving again produces a byte-identical file.

**Why this priority**: Silent word-joining on a no-op save is data corruption of
existing user content, and callouts are a first-class construct in this package.

**Independent Test**: Round-trip the fixture inputs through
`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`
and assert the output is byte-identical to the input; then round-trip the output a
second time and assert it equals the first pass (fixed point).

**Acceptance Scenarios**:

1. **Given** a `NOTE` callout whose first content line is `This has **bold** in it.`,
   **When** it is round-tripped through the editor's Markdown pipeline, **Then** the
   space before `**bold**` is preserved and the output is byte-identical to the input.
2. **Given** the output of that round-trip, **When** it is round-tripped a second time,
   **Then** the result is identical to the first pass (fixed point).
3. **Given** the same shape (text immediately followed by a formatted span on a
   callout's first content line) using `_italic_`, `` `code` ``, `~~strike~~`, or a
   `[link](url)` in place of `**bold**`, **When** round-tripped, **Then** the preceding
   space is preserved in each case.
4. **Given** the same shape using a `TIP` or `WARNING` callout instead of `NOTE`,
   **When** round-tripped, **Then** the preceding space is preserved.

---

### Edge Cases

- The formatted span sits on the callout's **first** content line, directly after the
  `[!NOTE]`/`[!TIP]`/`[!WARNING]` marker line — this is the shape that is broken today.
- The formatted span sits on a **later** paragraph of the callout body (already covered
  by `callout/inline-formatting.md`) — must remain unaffected by this fix.
- The formatted span is the **first** thing on the callout's first content line (no
  preceding prose, e.g. `> [!NOTE]` / `> **bold** text.`) — there is no preceding space
  to lose in this shape, but the fix must not introduce a new defect here.
- A plain blockquote (no callout marker) — must remain unaffected by this fix; its own,
  unrelated defect is tracked in #18.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A callout whose first content line contains text immediately followed by
  an inline-formatted span (bold, italic, inline code, strikethrough, or a link) MUST
  preserve the space between that text and the formatted span on round-trip.
- **FR-002**: FR-001 MUST hold for all three callout kinds this issue covers: `NOTE`,
  `TIP`, and `WARNING`.
- **FR-003**: The fix MUST NOT alter the existing, correct round-trip behavior of a
  formatted span on a callout's **second or later** paragraph (the shape
  `callout/inline-formatting.md` already covers).
- **FR-004**: The fix MUST NOT alter the round-trip behavior of a plain blockquote
  (no callout marker) — that is out of scope, tracked separately as #18.
- **FR-005**: The round-trip pipeline
  (`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`)
  MUST reach a fixed point on the second pass for every fixture added by this issue.
- **FR-006**: New round-trip fixtures MUST be added to the package's existing
  round-trip corpus covering, at minimum: the original bold reproduction, plus the same
  first-line-preceding-text shape for italic, inline code, strikethrough, and a link,
  each in at least one callout kind, with the three callout kinds (`NOTE`, `TIP`,
  `WARNING`) each represented by at least one fixture.
- **FR-007**: The existing `known-defects/other-callout-first-line-inline-formatting-
  space-lost.md` fixture's `.expected.md` sidecar MUST be removed once this issue is
  fixed, so the fixture becomes a byte-identical, permanent regression gate — following
  the precedent already established for the `897-*` and `903-*` fixture groups in this
  corpus (left in place under `known-defects/`, not moved, since that directory tracks
  fixture origin rather than current defect status).

### Key Entities

- **Round-trip fixture**: a Markdown file in the package's round-trip corpus
  (`src/app/mapper/__tests__/fixtures/roundtrip/`), optionally paired with an
  `.expected.md` (normalized output) and/or an `.idempotence-exempt.txt` sidecar.
  Fixtures under `known-defects/` record behavior currently accepted as broken.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each fixture added by FR-006 round-trips byte-identical to its input and
  reaches a stable fixed point on a second pass.
- **SC-002**: `known-defects/other-callout-first-line-inline-formatting-space-lost.md`
  round-trips byte-identical to its input (no `.expected.md` sidecar), becoming a
  permanent regression gate.
- **SC-003**: The existing round-trip fixture corpus continues to pass unchanged —
  `callout/inline-formatting.md` and every other existing fixture keep their current,
  correct behavior; no unrelated fixture is added, removed, or reclassified.
- **SC-004**: The full package test suite plus
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test` pass.

## Assumptions

- The defect is specific to the callout's **first** content line (the line immediately
  following the `[!NOTE]`/`[!TIP]`/`[!WARNING]` marker), not to callouts generally —
  consistent with `callout/inline-formatting.md` already passing for the same inline
  shapes placed on a later paragraph, and with the existing
  `known-defects/other-callout-first-line-inline-formatting-space-lost.md` fixture's own
  naming and documented cause.
- New fixtures follow this corpus's `NNN-*` issue-number-prefixed naming convention
  (i.e. `19-*`) and live directly under `fixtures/roundtrip/`, consistent with other
  regression-shaped fixture groups (`973-*`, `943-*`, `902-*`) — as distinct from the
  existing `callout/` directory, which the corpus's own README documents as
  feature-shaped coverage for #1, not regression coverage for a specific defect.
- This issue's callout-kind coverage is limited to `NOTE`, `TIP`, and `WARNING`, per the
  issue's own acceptance criteria — `IMPORTANT` and `CAUTION` (the other two kinds this
  package's `CalloutType` supports) are expected to benefit from the same fix, since the
  callout-kind marker does not participate in the defect mechanism, but are not required
  to get a dedicated fixture by this issue.
- FR-006's coverage does not require testing every format against every callout kind
  (a full 5-format x 3-kind matrix); one representative fixture per format, plus
  separate fixtures confirming each of the three callout kinds triggers the same
  bold reproduction, is sufficient to satisfy the issue's acceptance criteria as
  written. The exact fixture set remains a Research/Plan-stage decision.

## Out of Scope

- The plain-blockquote multi-paragraph collapse defect (#18) — reproduces
  independently and is tracked separately, even though it may share a root cause with
  this issue in how quote-like containers flush inline children.
- Callout kinds other than `NOTE`, `TIP`, and `WARNING` receiving dedicated fixture
  coverage (see Assumptions).
- Any other known Markdown round-trip idempotence defect in the corpus
  (`known-defects/` entries other than the one named in FR-007 remain as they are).
- Editor UI, keybinding, or user-facing formatting behaviour beyond serialization
  correctness.

## Source References

- `src/app/mapper/mdastToLexical.ts` — `convertBlockquote`'s callout detection, which
  computes the callout's first line of body text via
  `firstText.value.slice(calloutMatch[0].length).trim()`.
- `src/app/mapper/__tests__/fixtures/roundtrip/known-defects/other-callout-first-line-
  inline-formatting-space-lost.md` (+ `.expected.md`) — the existing fixture
  documenting this defect's current, accepted output.
- `src/app/mapper/__tests__/fixtures/roundtrip/callout/inline-formatting.md` — the
  passing sibling fixture that avoids the defect by using the callout's second
  paragraph.
- `src/app/mapper/__tests__/fixtures/roundtrip/README.md` — corpus conventions,
  including the `known-defects/` promotion precedent (`897-*`, `903-*`) this issue
  follows.
- Liminis issue #18 — the related, separately tracked plain-blockquote defect.
- Liminis issue #973 — prior instance of the same "silent word-joining on a no-op save"
  defect class in this package.

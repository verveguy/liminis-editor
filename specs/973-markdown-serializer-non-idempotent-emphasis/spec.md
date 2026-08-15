# Feature Specification: Markdown serializer idempotence for emphasis/strong adjacent to inline code

**Feature Branch**: `fabrik/issue-973`
**Created**: 2026-08-11
**Status**: Draft
**Input**: User description: "Markdown serializer non-idempotent: emphasis/strong (`*`/`**`/`__`) directly adjacent to an inline `code` span loses its wrapper and drifts on round-trip"

## Background

In `@liminis/editor`, a `lexical → mdast → markdown` round-trip is **not idempotent** when emphasis
or strong text sits directly against an inline-code boundary. A span like `` **`code` more text** ``
loses its `**` wrapper on the first pass, and on a second pass the now-bare markers drift further
(e.g. `**` → `\*\*`).

This breaks the fixed-point property the round-trip corpus is supposed to guarantee, and it corrupts
real content: several of Liminis's own docs (a dozen-plus ADRs under
`docs/project_notes/decisions/`) contain `**bold**` sitting directly against an inline-code span.
Because the editor is the canonical writer for Markdown notes, a user who merely opens and saves
such a document has its formatting silently destroyed, and each subsequent save degrades it further.

The same defect was diagnosed in **Zusammen** — which forked this exact mapper from Liminis
@ `f95cce45` — as its issue #71 / PR #72. **That fix never shipped.** PR #72 is closed and unmerged,
and every file it touched lives under `app/src/editor/`, the forked mapper tree that Zusammen deleted
when it adopted `@liminis/editor` (its issue #102). Zusammen's issue #71 shows `COMPLETED`, but it
was swept closed by that adoption work, not by the fix landing — a trap for anyone spot-checking.

So **neither application carries this fix today**, and the dependency direction is now inverted:
Zusammen consumes this mapper *from* `@liminis/editor` and is exposed to the same corruption until
its pin advances past this change. Landing it here is the only path by which Zusammen receives it.
That raises the stakes rather than lowering them. This work belongs to the same "idempotency fixes
Liminis lacks" family deliberately held out of the parity-constrained extraction work (#938), which
is why it needs an issue of its own.

The root cause is that a code-formatted Lexical `TextNode` which **also** carries a
bold/italic/strikethrough bit is treated as *pure* inline code and pulled out of its enclosing
emphasis/strong wrapper. Three sites in `packages/editor/src/app/mapper/lexicalToMdast.ts` exhibit
this: the mergeable-format computation excludes code-formatted nodes outright; the inline-phrasing
conversion takes a pure-inline-code fast path without checking for other format bits; and the text
node conversion short-circuits to a bare `inlineCode`, discarding the wrapper it had just built.

Two further sites, not visible from the symptom, also participate: the formatted-run gate in
`convertInlineUnit` (narrowed by #970/#977 in a way that makes the obvious fix emit a *different*
corruption), and `mergeableRunBounds`, which computes delimiter-run bounds for annotate-mode
sentinel placement and consults the code branch before the mergeable-format computation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bold text touching inline code survives editing (Priority: P1)

A user writes a note containing `` **`--flag` sets the mode** `` — bold text that begins with an
inline-code span. They open the note in the Liminis editor and save it (with or without making any
change). The bold formatting is preserved exactly as written, both in the rendered editor and in the
Markdown file on disk. Saving again produces a byte-identical file.

**Why this priority**: This is silent data corruption of user content on a no-op edit. It affects
existing real documents in this repository, and the damage compounds with each save.

**Independent Test**: Round-trip the fixture inputs through
`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown` twice and
assert the second pass equals the first.

**Acceptance Scenarios**:

1. **Given** a document containing `` **`code` more text** ``, **When** it is round-tripped through
   the editor's Markdown pipeline, **Then** the strong wrapper is retained in the output.
2. **Given** the output of that first round-trip, **When** it is round-tripped a second time,
   **Then** the result is identical to the first pass (fixed point).
3. **Given** a document containing `` *`code` more text* `` or `` __`code` more text__ ``,
   **When** it is round-tripped twice, **Then** the emphasis/strong wrapper survives and the result
   is a fixed point.
4. **Given** a document containing `` **`code1` middle `code2`** `` (two code spans inside one
   strong wrapper), **When** it is round-tripped twice, **Then** both code spans and the single
   enclosing wrapper are preserved and the result is a fixed point.
5. **Given** a document containing `` **`code`** `` (a wrapper whose entire content is code),
   **When** it is round-tripped twice, **Then** the wrapper is preserved and the result is a fixed
   point.

---

### User Story 2 - Real project documents round-trip unchanged (Priority: P2)

A maintainer opens one of the project's own ADRs — which mix `**bold**` and inline code freely —
in the editor and saves it. The document is not degraded.

**Why this priority**: Confirms the fix holds against realistic, messy content rather than only
against minimal synthetic fixtures. Zusammen's equivalent regression test exercises five real
in-repo ADRs; the Liminis test should use real Liminis documents.

**Independent Test**: A test that reads several real in-repo Markdown documents containing
`**bold**` abutting inline code and asserts the second-pass-equals-first-pass fixed point for each.

**Acceptance Scenarios**:

1. **Given** a real in-repo document whose `**bold**` abuts an inline-code span, **When** it is
   round-tripped twice through the editor pipeline, **Then** the second pass equals the first.

---

### Edge Cases

- Emphasis/strong wrapping **only** an inline-code span, with no surrounding text (`` **`code`** ``) —
  a run that is entirely code-styled must still keep its wrapper and its original marker style.
- Multiple consecutive code-formatted segments inside a single wrapper — these must be emitted as
  their own inline-code node(s) inside the wrapper rather than splitting the wrapper apart.
- Underscore-style strong (`__…__`) and single-asterisk emphasis (`*…*`) must retain their original
  marker characters, not be normalized to a different marker by the fix.
- Code combined with strikethrough or italic (not just bold) must behave the same way.
- Marks/annotations that overlap a code span inside a wrapper must continue to split and merge as
  they do today for plain code runs.
- Content where inline code carries *no* additional format bit must continue to take the existing
  fast path unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A Lexical text node that carries the code format **together with** a
  bold, italic, or strikethrough bit MUST be serialized as an inline-code node nested inside the
  corresponding emphasis/strong/delete wrapper, not as a bare top-level inline-code node.
  - **FR-001a**: When a node carries *more than one* such bit, the wrappers MUST nest in a fixed
    order — **bold innermost, then italic, then strikethrough outermost** — so the output is stable
    across passes, as FR-005 requires. This pins the order both wrapper builders already use; it is
    not a new choice. A source document written in the other order (`` **_`code`_** ``) is
    canonicalized to this one on the first pass and is a fixed point thereafter, which ADR-076
    permits as a one-time canonicalization.
  - **FR-001b**: The combination is **not** symmetric across all three bits, and this spec does not
    claim it is. Code+bold and code+italic are achievable; **code+strikethrough is not**, because
    `convertDelete` in `mdastToLexical.ts` calls `setFormat('strikethrough')` and so erases the
    `code` bit on *import* — no such node ever reaches the serializer. That is a separate import-side
    defect, out of scope here (see Out of Scope).
- **FR-002**: A text node carrying the code format and **no** other format bit MUST continue to
  serialize exactly as it does today (bare inline code, existing run-merging behaviour intact).
- **FR-003**: Consecutive code-formatted members within a single formatted run MUST be flushed as
  their own inline-code node(s) inside the wrapper, preserving the existing mark split/merge
  handling that plain code runs already receive.
- **FR-004**: A run whose members are all code-styled MUST retain its original strong/emphasis
  marker style (e.g. `__` stays `__`, `*` stays `*`) rather than being normalized or dropped.
- **FR-005**: The round-trip pipeline
  (`parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`) MUST reach
  a fixed point on the second pass for all inputs described in this spec.
- **FR-006**: New round-trip fixtures MUST be added to the package's existing round-trip corpus
  covering, at minimum: `` **`code`** ``, `` **`code` more text** ``, `` **more text `code`** ``,
  `` **`code1` middle `code2`** ``, `` *`code` more text* ``, and `` __`code` more text__ ``.
- **FR-007**: A regression test MUST cover real in-repo Liminis documents whose `**bold**` abuts an
  inline-code span and assert the second-pass-equals-first-pass fixed point for each.
  - **FR-007a**: That test MUST carry an **anti-vacuity guard**, or a later edit that removes the
    pattern from the selected documents would leave a green suite covering nothing.
    Specifically: it MUST select documents by matching the interior-mixed pattern (bold with a code
    span *inside* it — standalone adjacency is not the defect and has no regression value); it MUST
    fail if the selected set is empty or falls below a stated floor; and it MUST re-assert that a
    document exhibits the pattern immediately before asserting that document's fixed point.
    Precedent: the corpus-wide anti-vacuity counters in `annotated-serialize-corpus.test.ts`.
  - **FR-007b**: It MUST assert **second-pass == first-pass only**, never first-pass == source
    bytes; the ADRs contain constructs that hit unrelated, already-accepted normalizations. Any
    document excluded from the assertion MUST carry an individually diagnosed prose reason, per
    ADR-076's "individually documented, never batched" rule.
  - **FR-007c**: The documents MUST be **vendored into the package** as byte-identical copies with
    recorded provenance, not read live from the application repository. No test under
    `packages/editor/` may read outside the package: #949 extracts this package into
    `verveguy/liminis-editor`, where a live read would either fail on day one or be "fixed" by a
    skip that makes the suite permanently vacuous — the exact rot FR-007a exists to prevent. The
    vendored set MUST NOT live under `fixtures/roundtrip/`, which five auto-discovering corpus
    suites scan.
- **FR-008**: No public API of `@liminis/editor` may change; Markdown parsing and stringification
  behaviour outside the described defect MUST be unaffected.
- **FR-009**: No existing round-trip fixture may be added, removed, or altered other than the new
  cases required by FR-006, and no fixture currently classified as a known defect may change
  classification.

### Key Entities

- **Round-trip fixture**: a Markdown file in the package's round-trip corpus, optionally paired with
  an `.expected.md` (normalized output) and/or an `.idempotence-exempt.txt` sidecar. Fixtures under
  `known-defects/` record behaviour that is accepted as broken today.
- **Formatted run**: a contiguous sequence of Lexical text nodes sharing a mergeable format bit,
  serialized as a single emphasis/strong/delete mdast wrapper.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of the six inputs in FR-006 round-trips to a stable fixed point (second pass ==
  first pass), verified by fixtures in the package's round-trip corpus.
- **SC-002**: A regression test covers real Liminis documents whose `**bold**` abuts an inline-code
  span and asserts the second-pass-equals-first-pass fixed point.
- **SC-003**: The existing round-trip fixture corpus continues to pass unchanged — no fixture
  added/removed/altered other than the new cases, and no `known-defects` case flips.
- **SC-004**: The full package test suite plus `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  pass.

## Assumptions

- The behavioural fix is confined to the Lexical → mdast mapper; no change to the Markdown parser or
  stringifier is required.
- New fixtures follow this corpus's naming convention of an issue-number prefix (i.e. `973-*`),
  rather than reusing Zusammen's `71-*` names.
- "Real Liminis documents" for FR-007 means genuine, human-written in-repo Markdown — the 32 ADRs
  under `docs/project_notes/decisions/` that exhibit `**bold**` abutting inline code. Per FR-007c
  these are vendored into the package as byte-identical copies rather than read live, so the suite
  survives the #949 extraction. They are a *snapshot*: the requirement is that the content be
  realistic, not that it track the live ADRs, so there is no obligation to keep them in sync.
- The Zusammen reference implementation is available for consultation via
  `gh pr diff 72 --repo verveguy/zusammen` (branch `fabrik/issue-71`); it is a reference, not a
  constraint — Liminis's copy of the mapper has diverged in line numbering and may have diverged
  elsewhere, so the fix must be validated against Liminis's own corpus.

## Out of Scope

- Any other known Markdown round-trip idempotence defect in the corpus (`known-defects/` entries
  remain as they are).
- Broader upstreaming of other Zusammen mapper divergences.
- Editor UI, keybinding, or user-facing formatting behaviour beyond serialization correctness.
- Migration or repair of already-corrupted documents on disk.
- **Markdown escaping behaviour, including the `**` → `\*\*` drift described in Background.** This
  is excluded with reasoning rather than by fiat, because fixing the wrapper could be mistaken for
  *hiding* an escaping defect. It does not. `stringify.ts` applies no custom asterisk handling at
  all — asterisks go through `mdast-util-to-markdown`'s stock `safe()`, whose behaviour here is
  correct. The drift was a *consequence* of the wrapper loss: a marker the mapper should never have
  emitted bare was left flush against a backtick, where CommonMark's flanking rules re-read it as
  literal text and `safe()` duly escaped it. Removing the wrong input removes the drift. Stability
  of a *genuinely* literal `\*\*` is pre-existing, already covered by `offset-spans.test.ts`
  (L134/L145), and pinned by the new `973-literal-asterisks-near-code.md` fixture so it is a
  red-able assertion rather than an argument. A separate, unrelated escaping defect *was* found
  while validating FR-007 — `adr-021.md` has runs whose closing `**` is preceded by a space, so the
  asterisks are literal and drift on the second pass — reproduced against the pre-fix mapper,
  excluded with a reason, and tracked separately.
- **The import-side `convertDelete` defect** (`mdastToLexical.ts` uses `setFormat` where it needs
  `toggleFormat`, erasing the `code` bit and any other format bits on import). It blocks the
  code+strikethrough combination noted in FR-001b and in Edge Cases. It is stable rather than
  drifting, no FR-006 fixture requires it, and fixing it would change existing fixture output —
  a genuinely separate defect, tracked separately.

## Source References

- `packages/editor/src/app/mapper/lexicalToMdast.ts` — `getMergeableFormat` (~line 1043),
  `convertInlinePhrasingList` (~line 1228), `convertFormattedRun`, `convertTextNode` (~line 1322)
- `packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/` — round-trip fixture corpus
- `packages/editor/src/app/mapper/__tests__/roundtrip-test-utils.ts` — corpus harness, including
  `.expected.md` and `.idempotence-exempt.txt` sidecar handling
- `docs/project_notes/decisions/` — real ADRs exhibiting the defect
- verveguy/zusammen issue #71 / PR #72 (branch `fabrik/issue-71`) — reference implementation,
  fixtures, and ADR idempotence test
- Liminis issue #938 — editor extraction, where this class of fix was declared out of scope

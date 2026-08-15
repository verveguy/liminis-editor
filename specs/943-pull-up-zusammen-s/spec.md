# Feature Specification: Pull up Zusammen's markdown round-trip idempotency fixes into `@liminis/editor`

**Feature Branch**: `fabrik/issue-943`
**Created**: 2026-08-04
**Status**: Draft
**Input**: User description: "Pull up Zusammen's markdown round-trip idempotency fixes into @liminis/editor — two genuine round-trip defects fixed in Zusammen's forked copy of `stringify.ts` (`verveguy/zusammen#62`, closing its #50) that Liminis still carries, plus the idempotence test harness that caught them."

## Background

`@liminis/editor` now exists (#938), so the markdown pipeline has a single home. Zusammen fixed two genuine round-trip defects in its forked copy of `stringify.ts` (`verveguy/zusammen#62`, closing its #50) that Liminis still carries. #938 deliberately excluded them — they are a behaviour change and therefore incompatible with that phase's byte-for-byte parity constraint — and flagged them so they would not be lost. This is that follow-up.

Both defects are live in `packages/editor/src/markdown/stringify.ts` today (verified: lines 271 and 379). Pulling them up fixes Liminis, and lands them in the package that Zusammen will eventually consume (#940), so the fix stops being something anyone has to hand-port.

Zusammen's version of the file is otherwise byte-identical to ours — the entire divergence is the two hunks below, plus the test harness. This is a small, well-understood port, not a rewrite.

### Defect 1 — a blank line before a list is silently dropped

`stringify.ts` has a `join` override implementing a "label:" convention — a paragraph ending in `:` gets zero blank lines before the block that follows, so `Fenced code:` hugs its code fence. `list` is wrongly in that set:

```js
if (endsWithColon && ['list', 'table', 'code', 'math'].includes(right.type)) {
  return 0; // No blank line
}
```

A colon-ending paragraph followed by a list loses its blank line, unlike every other preceding-block type. Removing `'list'` from the array is the fix; `table`/`code`/`math` keep the convention unchanged.

### Defect 2 — a post-process regex corrupts verbatim content

```js
result = result.replace(/\n{3,}/g, '\n\n');
```

`mdast-util-to-markdown`'s own join logic already never emits 3+ newlines between sibling blocks, so this has no legitimate job left. Its only real effect is destroying intentional multi-blank-line runs **inside fenced code blocks and frontmatter YAML block scalars** — content that must survive verbatim. Deleting it is the fix.

### What is missing structurally

Neither defect was caught because `fixture-roundtrip.test.ts` only asserts one pass: input → output. It never checks that output is a **fixed point**. Zusammen added a second-pass assertion, which immediately surfaced a genuine pre-existing non-idempotency in the #902 hard-break normalization (a double-hard-break serializes as a whitespace-only line, which CommonMark treats as blank on re-parse). Rather than delete or silently skip those fixtures, it added an opt-out `.idempotence-exempt.txt` sidecar so each exemption is documented and visible.

Liminis has **85 input fixtures and no idempotence assertion at all** (verified). Zusammen has 101 (85 + 16 new `50-*` fixtures from #62) and **5 documented exemptions**, all in the `902-list-item-double-hard-break` family.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Blank line before a list survives a save (Priority: P1)

A user writes a note with a label-style lead-in — `Steps to reproduce:` — followed by a blank line and a bulleted list. They open the note in Liminis, edit an unrelated paragraph, and save. The blank line before the list is still there.

**Why this priority**: This is the reported defect. It silently mutates users' documents on every save, and the mutation is invisible in the WYSIWYG view — it only shows up in the file on disk and in git diffs.

**Independent Test**: Round-trip a fixture containing a colon-ending paragraph, a blank line, and a list; assert the output is byte-identical to the input.

**Acceptance Scenarios**:

1. **Given** a note containing `Steps to reproduce:` followed by a blank line and a bulleted list, **When** the user opens it, edits an unrelated paragraph, and saves, **Then** the blank line before the list is still there.
2. **Given** a colon-ending paragraph followed by a numbered list, **When** the note is round-tripped, **Then** the blank line is preserved.
3. **Given** a colon-ending paragraph followed by a fenced code block, table, or math block, **When** the note is round-tripped, **Then** the existing zero-blank-line "label:" convention is unchanged.
4. **Given** a colon-ending paragraph followed by a list *inside a list item*, **When** the note is round-tripped, **Then** behaviour is unchanged — that path already takes a different branch (`parent?.type !== 'listItem'`).

---

### User Story 2 - Verbatim content survives a save byte-for-byte (Priority: P1)

A user has a note with a fenced code block containing two consecutive blank lines, and frontmatter using a YAML block scalar that also contains blank lines. They open and save the note. Both are unchanged.

**Why this priority**: Silent corruption of code and configuration content is worse than a cosmetic diff — it can break the code or config the note is documenting.

**Independent Test**: Round-trip fixtures containing multi-blank-line runs inside a fenced code block and inside a YAML block scalar; assert byte-identity.

**Acceptance Scenarios**:

1. **Given** a note with a fenced code block containing two consecutive blank lines, **When** the user opens and saves it, **Then** the code block's contents are byte-identical, blank lines included.
2. **Given** a note with frontmatter using a YAML block scalar that contains blank lines, **When** the user opens and saves it, **Then** the frontmatter is unchanged.

---

### User Story 3 - Saved documents are a fixed point (Priority: P1)

Any document already saved once by Liminis, opened and saved again with no edits, does not change on disk.

**Why this priority**: This is the structural guarantee that would have caught both defects. Without it, each new serialization rule risks introducing a slow document drift that no test detects.

**Independent Test**: For every fixture in the corpus, feed its own first-pass output back through the pipeline and assert the second-pass output is identical.

**Acceptance Scenarios**:

1. **Given** any fixture without an exemption sidecar, **When** its first-pass output is round-tripped again, **Then** the second-pass output is identical to the first.
2. **Given** a fixture with a known, accepted non-idempotency, **When** the suite runs, **Then** the fixture carries an `.idempotence-exempt.txt` sidecar stating why, and the second-pass assertion is skipped for it.

---

### Edge Cases

- Enabling idempotence across Liminis's 85 fixtures may surface **more** non-idempotency than Zusammen's 5 exemptions. The corpora differ — Liminis's was built by #896 and hardened by #897–#919; Zusammen forked before most of that. Each new failure needs a judgement call: real bug to fix here, or accepted normalization to exempt with a written reason. Do not batch-exempt to get green.
- A colon-ending paragraph followed by a list *inside a list item* already takes a different branch (`parent?.type !== 'listItem'`). Confirm FR-001 does not change that path.
- The #902 double-hard-break normalization is expected to need exemption in Liminis as it did in Zusammen. Confirm rather than assume — Liminis's #902 handling may have diverged.
- The `known-defects` fixture group asserts *current defective* behaviour by design. If enabling idempotence makes one of those fixtures fail the second pass, exempt and document it — do not "fix" the defect it encodes.
- Removing the `\n{3,}` collapse could, in principle, allow 3+ newlines to reach the output between sibling blocks if `mdast-util-to-markdown`'s join logic does not in fact cover every case. Fixtures with multiple blank lines between paragraphs and before lists cover this.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `'list'` MUST be removed from the colon-ending-paragraph zero-blank-line join override in `packages/editor/src/markdown/stringify.ts`. `table`, `code` and `math` MUST retain the existing behaviour.
- **FR-002**: The `result.replace(/\n{3,}/g, '\n\n')` post-process MUST be removed from `stringify.ts`.
- **FR-003**: `fixture-roundtrip.test.ts` MUST add a second-pass idempotence assertion: every fixture's own output, round-tripped again, MUST be an unchanged fixed point. This applies to fixtures whose first pass legitimately changes bytes (those with `.expected.md` sidecars) as well as byte-identical ones.
- **FR-004**: An opt-out MUST exist for fixtures with documented, accepted non-idempotency, following Zusammen's `.idempotence-exempt.txt` sidecar convention (a sidecar next to the fixture whose contents are the written reason). Each exemption file MUST state why. Exemptions MUST NOT be used to paper over non-idempotency introduced by this issue.
- **FR-005**: The `50-*` fixtures from Zusammen (16 inputs, plus an `.expected.md` sidecar for each input whose first pass intentionally changes bytes — 5 of the 16; the rest are byte-identical and correctly have no sidecar) MUST be ported, covering: the reported defect, every other preceding-block type before a list (heading, blockquote, code, table, list), multi-blank-line collapse, verbatim preservation in fenced code and frontmatter, and edge cases (nested lists, list as first/last block).
- **FR-006**: The existing `known-defects` fixtures MUST continue to assert current defective behaviour. They MUST NOT be opportunistically "fixed" here — same constraint as #938 FR-007.
- **FR-007**: The fixtures README (`packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/README.md`) MUST document the idempotence assertion, the exemption convention, and every exemption granted.
- **FR-008**: The one-time canonicalization this introduces MUST be recorded — either as an amendment to ADR-075 or as a new ADR — including which document shapes change on first save.
- **FR-009**: Any existing `.expected.md` sidecar whose content must change as a result of FR-001 or FR-002 MUST be changed only for one of those two documented reasons, and each such change MUST be individually justified in the PR.

### Key Entities

- **Fixture**: an input `*.md` file under `packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/` (including subdirectories). Its expected output is either itself (byte-identity) or a sibling `.expected.md` sidecar.
- **Idempotence exemption sidecar**: a `<fixture-name>.idempotence-exempt.txt` file next to a fixture whose contents are a written justification for skipping the second-pass assertion for that fixture.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every existing fixture that passes today still passes, except where its `.expected.md` changes for one of the two documented reasons, and each such change is reviewed individually.
- **SC-002**: Every fixture without an exemption sidecar reaches a fixed point on the second pass.
- **SC-003**: A fenced code block and a YAML block scalar each containing 2+ consecutive blank lines survive a round trip byte-identically.
- **SC-004**: A colon-ending paragraph followed by a blank line and a list survives a round trip byte-identically; the same paragraph followed by a table, fenced code block, or math block retains its zero-blank-line join.
- **SC-005**: The corpus contains at least 101 input fixtures (85 existing + the 16 ported `50-*` inputs).
- **SC-006**: Every idempotence exemption in the repository has a sidecar with a non-empty written reason, and every one of them is listed in the fixtures README.
- **SC-007**: The full workspace suite, typecheck, lint and **e2e** are green. (e2e is explicitly named: it was the only job that caught the renderer regression during #938's Validate — `unit-tests` passing is not sufficient evidence for editor changes.)

## Assumptions

- This is a **behaviour change, accepted deliberately**. Any real document with a colon-ending paragraph immediately followed by a list gains a blank line on its first save after this ships. That is a visible one-time diff in users' notebooks, and it is the intended outcome — it makes Liminis match every other preceding-block type.
- No repo-wide `.md` normalization pass. Documents canonicalize as they are saved. A bulk pass would bury the actual fix in noise.
- Zusammen source is on the local filesystem at `~/dev/zusammen` (verified: `app/src/editor/markdown/stringify.ts`, and `app/src/editor/app/mapper/__tests__/fixtures/roundtrip/` containing the 16 `50-*` inputs and 5 `.idempotence-exempt.txt` sidecars). No clone or API access needed.
- Zusammen's `stringify.ts` is otherwise byte-identical to Liminis's; the port is the two hunks plus the harness, not a file-level replacement.
- The choice between amending ADR-075 and writing a new ADR (FR-008) is left to the Plan stage; either satisfies the requirement.

## Out of Scope

- The reverse port — Liminis's post-#896 corpus and fidelity fixes into Zusammen. That resolves when Zusammen adopts the package (#940), not by hand-porting.
- Fixing the #902 hard-break non-idempotency itself. Exempt and document it; it needs its own issue.
- The unified annotation mechanism (#939) and OSS hardening (#940).
- Any repo-wide or notebook-wide normalization of existing `.md` documents.

## Source References

- `packages/editor/src/markdown/stringify.ts` — line 271 (defect 1), line 379 (defect 2)
- `packages/editor/src/app/mapper/__tests__/fixture-roundtrip.test.ts` — the harness to extend
- `packages/editor/src/app/mapper/__tests__/roundtrip-test-utils.ts` — fixture discovery, where sidecar support lands
- `packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/README.md` — fixture/sidecar conventions
- `~/dev/zusammen/app/src/editor/markdown/stringify.ts` — the two hunks, diffable against ours
- `~/dev/zusammen/app/src/editor/app/mapper/__tests__/` — the idempotence harness, exemption sidecars, and `50-*` fixtures
- `verveguy/zusammen#62` — the original fix; `zusammen#50` — the defect report
- #938 / `docs/project_notes/decisions/adr-075.md` — the extraction that made this a single-site fix; its Out of Scope names this work
- `specs/896-build-a-lexical-markdown/spec.md`, #897–#919 — the corpus this must not regress

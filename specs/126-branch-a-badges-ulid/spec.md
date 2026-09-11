# Feature Specification: Reconcile the ULID Badge Branch With the Resolver's Position Rule

**Feature Branch**: `fabrik/issue-126`
**Created**: 2026-09-09
**Status**: Specified
**Input**: User description: "Branch A badges ULID anchor shapes the resolver can never address"

## Background

Follow-up split out of #124 so it doesn't widen that PR's scope. Pre-existing from #122 — #124 neither introduces nor worsens it. #124 has since merged to `main` (PR #125, `facc262f`).

### The disagreement

#124 makes the badge detector agree with the resolver *by construction* for every id form — except ULID. Its implementation keeps two detection branches: **Branch A**, #122's original ULID rule, frozen with **no position constraint**, so a ULID badges anywhere on a line; and **Branch B**, every other id shape, gated by the resolver's own position rule. The resolver (`/(?:^|\s)\^([^\s\]#]+)\s*$/`, `verveguy/liminis#1109`, in the separate `verveguy/liminis` repository) requires the caret to start a token (line-start or preceded by whitespace) and the id to run to end of line.

This is the **inverse** of the defect #124 fixes. #124's case was "UI says it isn't an anchor while the system treats it as one." This is "UI says it *is* an anchor while the system can't address it" — a ULID badged mid-line can never be the target of a `[[file#^id]]` reference, because the resolver will never match it there.

### What #122's fixtures actually assert

Every fixture in `roundtrip/122-block-anchor/` that carries a ULID, checked against the resolver rule:

| fixture | lines with a ULID | resolver can address |
|---|---|---|
| `checkbox-anchor.md` | 1 | **1** |
| `multiple-anchors.md` | 2 | 0 |
| `anchor-after-wikilink.md` | 1 | 0 |
| `anchor-in-emphasis-strong.md` | 1 (two ids) | 0 |
| `checkbox-anchor-formatted.md` | 2 | 0 |

**Exactly one fixture encodes an anchor the system can resolve** — and it is the one that looks like real authoring:

```
- [ ] @me Draft the boundary doc by 2026-09-15 ^01M00VDX0S4JHMDNA7F776Y8R8
```

One anchor, end of line. That is the shape `liminis-framework`'s actions tooling emits, and the shape #124's position rule (Branch B) is built around.

`multiple-anchors.md` does **not** test multiple anchors per line — a common early misreading of its name. It is a single paragraph of three lines with one anchor per line, each mid-line:

```
The first decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and the
second one landed separately ^01M00VDX0S4JHMDNA7F776Y8R9, with ordinary
prose in between and after.
```

"Multiple" means multiple per *paragraph*, not per line. The only fixture that genuinely puts two ids on one line is `anchor-in-emphasis-strong.md` (`*emphasized text*^ULID and **bold text**^ULID too.`), which reads as a synthetic parser-adjacency test rather than anything an author would write.

### Decision (2026-09-10): delete Branch A

The question this issue exists to answer was whether #122's mid-line fixtures encode product requirements or parser-robustness tests. Resolved: **mid-line anchor *definitions* are not a real shape.** What occurs mid-line in the production corpus is anchor *references* — `[[file#^id]]` / `![[file#^id]]` embedded in a sentence — which are wiki-links, parsed position-independently, and already work correctly; nothing about them is affected by this issue. Anchor *definitions* are written at end of line, as in `checkbox-anchor.md` — the one fixture, of five, whose ULID the resolver can actually address.

So #122's mid-line fixtures are parser-robustness tests, not product requirements, and Branch A exists only to keep badging shapes nothing can ever address.

**Branch A is deleted. The position rule applies universally — the two branches collapse into one.**

- `ULID_AT_CARET` and the try-A-then-B ordering in `findBlockAnchorMatches` go away; the position-gated path becomes the only path.
- Mid-line ULIDs stop badging. This is the intended outcome, not a regression — they could never be resolved, and the UI claiming otherwise is the defect this closes.
- Result: badge and resolver agree for every id form with no carve-out — the outcome #124 set out to achieve.

### The emphasis-wrapped case: split out to #127

`checkbox-anchor-formatted.md` (a bold- or italic-wrapped anchor at line end, e.g. `**^01M00VDX0S4JHMDNA7F776Y8R8**`) badges today but does not resolve, because the resolver requires the caret to be preceded by whitespace, not `*`/`_`. The decision on that case — widen the resolver (filed and merged as `verveguy/liminis#1114`/`#1115`) and widen Branch B to match it case-for-case — has been split out entirely into #127 (`fabrik/issue-127`), which is further along (Validate stage) and already carries its own detailed spec, requirements, and ADR-122 amendment obligations for that shape. **This issue does not duplicate that work.** See Source References.

### Not urgent, but now scheduled

Requires a ULID written mid-line rather than plainly at line end. No user-visible breakage is known — unlike #124's gap, which was live in `demo-notebook`. Filed so the reasoning isn't lost, not because anything was on fire — but the design question is now settled and this issue proceeds to implementation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A badged ULID is always resolvable (Priority: P1)

As an editor user, when a ULID-shaped block anchor renders as a badge, I want that badge to always correspond to something `[[file#^id]]` can actually resolve, so the badge is a reliable promise rather than sometimes-true UI decoration.

**Why this priority**: This is the defect this issue exists to fix — the badge currently overclaims resolvability for ULIDs, mirroring (in reverse) the defect #124 fixes for non-ULID ids.

**Independent Test**: Write a ULID mid-line (`The decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and continues.`) and confirm it no longer renders as a badge; write the same ULID at line end and confirm it still does.

**Acceptance Scenarios**:

1. **Given** a line containing `^01M00VDX0S4JHMDNA7F776Y8R8` followed by further prose on the same line, **When** the editor renders it, **Then** it does NOT display as a block-anchor badge (matches Branch B's existing behavior for every other id form).
2. **Given** a line ending in `^01M00VDX0S4JHMDNA7F776Y8R8` (optionally preceded by other content, e.g. a checkbox item), **When** the editor renders it, **Then** it continues to display as a badge (no regression for the real-authoring shape).
3. **Given** `checkbox-anchor.md` (the one #122 fixture whose ULID is already at line end), **When** the round-trip suite runs, **Then** it still passes unchanged.

---

### User Story 2 - A shared cross-repo case table prevents future drift (Priority: P2)

As a maintainer, I want the badge detector's accept/reject cases checked against a table that both this repository and `verveguy/liminis` assert against, so a future change to either rule that silently diverges from the other fails a test instead of being discovered as a live defect — as happened twice already: #124's original gap, and this issue's own ULID-position gap.

**Why this priority**: Not itself a defect fix. Once Branch A is gone, the whole badge rule reduces to one position test plus one charset test, and pinning it against the resolver's rule in a table both repos assert against becomes straightforward. With the carve-out gone there is no remaining excuse for the two rules to differ, and a shared table turns the next drift into a test failure instead of a filed issue.

**Independent Test**: Add or change a case in the shared table and confirm this repository's badge-detection tests assert against every row (not a hand-copied subset).

**Acceptance Scenarios**:

1. **Given** the shared case table lists an id/position combination and its expected accept/reject outcome, **When** this repository's badge-detection tests run, **Then** they assert against every row in the table.
2. **Given** a future change to this repository's position rule, **When** it diverges from a row in the shared table, **Then** the test suite fails rather than silently badging or refusing to badge inconsistently with the resolver.

---

### Edge Cases

- `anchor-after-wikilink.md` tests an anchor immediately following a `wikiLink` node (sibling-boundary handling). Rewrite: move its ULID to end of line, preserving the wikilink-adjacency scenario.
- `anchor-in-emphasis-strong.md` tests an anchor immediately following `emphasis`/`strong` nodes (the same sibling-boundary category), plus two anchors within one paragraph. Rewrite: move both ULIDs to end of line (one per line), preserving both the emphasis-adjacency scenario and the two-anchors-in-one-paragraph case.
- `multiple-anchors.md` tests multiple anchors within one *paragraph*, one per line — never multiple ids on a single line, despite the name. Rewrite: move each ULID to the end of its own line, preserving the paragraph-level multiplicity.
- All three rewrites MUST keep round-tripping byte-identically, and each rewrite's diff must state the fixture's original intent (per the notes above) so nothing is silently dropped.
- `checkbox-anchor-formatted.md` is untouched by this issue — its resolution (badging *and* resolving an emphasis-wrapped anchor) belongs entirely to #127.
- `anchor-in-code-not-badged.md` and `anchor-in-math-not-badged.md` are unaffected: code and math exclusion is structural (separate mdast node types), independent of ULID position.
- `truncated-malformed-id.md` and `non-anchor-carets.md` are unaffected: they exercise charset/length boundaries, not position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Branch A (`ULID_AT_CARET` and the try-A-then-B ordering in `findBlockAnchorMatches`) MUST be deleted. A ULID-shaped block anchor MUST be badged if and only if it satisfies the same position rule already applied to every other id form (caret starts a token; captured id runs to end of line, trailing whitespace permitted). No two-branch structure remains.
- **FR-002**: `roundtrip/122-block-anchor/multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` MUST be rewritten so each ULID sits at line end, continuing to exercise the same parser behavior each originally targeted (see Edge Cases for the per-fixture intent), and MUST continue to round-trip byte-identically.
- **FR-003**: ADR-122 MUST be amended (not rewritten, per this repository's ADR convention) to record: (a) that mid-line ULID *definitions* were never a supported shape — the mid-line cases seen in production are wiki-link *references*, parsed position-independently, unaffected by this change; (b) that Branch A's carve-out and the ADR's original "length is the disambiguating signal" rationale are both superseded by this decision; (c) why — badge/resolver agreement is now total for every id form with no carve-out.
- **FR-004**: The full `roundtrip/122-block-anchor/` fixture suite MUST pass after this change, and no fixture's assertion may silently change meaning without an explicit rewrite justified in the ADR-122 amendment.
- **FR-005**: A shared case table listing id/position combinations and their expected accept/reject outcome MUST be built and consumed as this repository's badge-detection test source of truth, pinned against `verveguy/liminis`'s resolver rule (`verveguy/liminis#1109`, as widened by `verveguy/liminis#1114`), so a future divergence between the two repositories' rules fails a test rather than shipping silently.

### Key Entities

Not applicable — no new data entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Badge and resolver agree for every ULID-bearing fixture in `122-block-anchor` — full agreement, not the prior 12-of-14 — with no case left ambiguous.
- **SC-002**: The `122-block-anchor` fixture corpus passes in full, including the three rewritten fixtures, byte-identical on round-trip.
- **SC-003**: A reader of ADR-122 after this issue ships can determine, without consulting this issue's history, why Branch A was removed and why mid-line ULID definitions are not a supported shape.
- **SC-004**: A shared cross-repo case table exists and is consumed by this repository's badge-detection tests as their source of truth (FR-005).

## Assumptions

- This issue's implementation depends on #127 (`fabrik/issue-127`) merging first: #127 is concurrently rewriting Branch B's boundary/charset logic, and would conflict directly with deleting Branch A. Implementation MUST land after #127 merges to `main`, rebasing onto its changes.
- The resolver (`verveguy/liminis`'s `fs.ts`) is out of this issue's control — it lives in a separate repository. This issue's shared case table (FR-005) coordinates with it without requiring a code change there.
- This issue's design vocabulary ("Branch A", "Branch B") describes #124's implementation as merged to `main` (PR #125, `facc262f`) and as further modified by #127. Since #127 is still open (Validate stage) at spec time, verify against its actual merged state before implementing.
- Production mid-line ULID occurrences are wiki-link references (`[[file#^id]]` / `![[file#^id]]`), not block-anchor definitions; those are parsed position-independently and are unaffected by this issue.

## Out of Scope

- Any change to the resolver's regex or behavior in `verveguy/liminis` (already merged as `verveguy/liminis#1114`/`#1115`).
- Emphasis-wrapped block anchors and Branch B's charset/wrapper matching — entirely #127's territory; this issue makes no changes there beyond whatever #127 has already landed by the time this issue is implemented.
- Migrating or changing how `liminis-framework`'s actions tooling writes anchors.
- Full cross-repo test wiring (e.g., a CI job in `verveguy/liminis` consuming this repository's table) beyond making the table exist and be this repository's source of truth — deeper integration is a candidate follow-up, not required here.

## Source References

- Issue #122 (original ULID-only badge decision), `docs/decisions/adr-122-block-anchor-badge.md`
- Issue #124 (widened non-ULID detection; introduced the Branch A/Branch B split this issue removes), `fabrik/issue-124` / PR #125 — merged, `facc262f`
- Issue #127 (`fabrik/issue-127`) — widens Branch B to accept a symmetric emphasis wrapper, paired with `verveguy/liminis#1114`; this issue's implementation must land after #127 merges
- `verveguy/liminis#1109` (original resolver rule, merged, separate repository) — `/(?:^|\s)\^([^\s\]#]+)\s*$/`
- `verveguy/liminis#1114` / PR `verveguy/liminis#1115` (resolver widened to accept a symmetric emphasis wrapper, merged, commit `19330368`, separate repository)
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the fixture corpus this issue reasons about)

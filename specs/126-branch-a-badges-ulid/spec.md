# Feature Specification: Reconcile the ULID Badge Branch With the Resolver's Position Rule

**Feature Branch**: `fabrik/issue-126`
**Created**: 2026-09-09
**Status**: Draft
**Input**: User description: "Branch A badges ULID anchor shapes the resolver can never address"

## Background

Follow-up split out of #124 so it doesn't widen that PR's scope. Pre-existing from #122 — #124 neither introduces nor worsens it. #124's PR (`fabrik/issue-124`, PR #125) is at the Validate stage with a merge pending at the time of this update; its design (as of commit `859e8f40`) is what this issue reasons about.

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

### The actual question this issue exists to answer

Not "is multiple-per-line supported" but: **do these fixtures encode product requirements, or parser-robustness tests?**

The evidence points mostly to the latter. `anchor-after-wikilink.md` (`See [[notes]]^ULID for details.`) and `anchor-in-emphasis-strong.md` assert that badging survives awkward inline adjacency — useful parser tests, but they describe anchors that can never be referenced. Nothing user-facing promises those shapes work, and #122's ADR reasons about *charset*, never about mid-line placement being a feature.

If that reading is right, Branch A exists solely to keep badging unaddressable shapes, and the position rule could be applied universally — collapsing Branch A and Branch B back into one rule, and making badge/resolver agreement total rather than near-total. `multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` would need their ULIDs moved to line end, preserving what they actually test (adjacency, charset, emphasis-marker round-tripping) without asserting an unresolvable shape.

**This question is not yet resolved — see Open Questions.**

### `checkbox-anchor-formatted.md` — resolved: widen the resolver, and match it in Branch B

```
- [ ] @me Draft the boundary doc by 2026-09-15 **^01M00VDX0S4JHMDNA7F776Y8R8**
- [ ] @me A second item with an italic anchor _^01M00VDX0S4JHMDNA7F776Y8R9_
```

This fixture badges today (via Branch A, which has no position constraint at all) but does not resolve, because the resolver requires the caret to be preceded by whitespace rather than `*`/`_`. **Decision: the resolver is the wrong side here, and it has been widened.** Filed as `verveguy/liminis#1114` (`liminis-app/src/main/fs.ts:817`, `ANCHOR_LINE_PATTERN`) to accept a block anchor wrapped in one level of matching emphasis/strong-emphasis markers at line end.

**This cannot be a resolver-only change — it pulls Branch B into scope for a matching allowance.** Measuring badge behavior on `fabrik/issue-124` (`859e8f40`) against both the current and the widened resolver rule shows a resolver-only change is net-zero, not a pure win:

| case | badge (Branch A/B today) | resolver (current) | resolver (widened, `verveguy/liminis#1114`) |
|---|---|---|---|
| `item **^<ULID>**` | badges (Branch A) | no — **disagree** | yes — agree |
| `item _^<ULID>_` | badges (Branch A) | no — **disagree** | yes — agree |
| `item **^a1b2c3**` | no badge (Branch B: caret not preceded by whitespace) | no — agree | yes — **new disagreement** |
| `squared *^2*` | no badge (Branch B) | no — agree | yes — **new false anchor** |
| `item ^<ULID>` | badges (Branch A) | yes — agree | yes — agree |
| `item ^a1b2c3` | badges (Branch B) | yes — agree | yes — agree |

Branch A needs no change for this (it already badges a wrapped ULID unconditionally, regardless of position). **Branch B does**: it must accept a block anchor wrapped in one level of matching emphasis/strong-emphasis markers (`*id*`, `_id_`, `**id**`, `__id__`) immediately preceding end of line, for every id form Branch B already accepts — mirroring `verveguy/liminis#1114`'s rule so the two components do not drift apart again, which is the exact failure #124 exists to fix. This rule must match `verveguy/liminis#1114`'s tested pattern case-for-case, including two flaws adversarial probing turned up there: a single-character wrapped digit (`*^2*`) resolves and badges with id `2` (an accepted residual, on the same reasoning as the `^100` residual #124's spec already accepted — a length floor would break short ids like `^a1b2c3`), and an asymmetric wrapper's capture behavior must match rather than diverge.

A single shared fixture list both repos assert against (rather than two hand-maintained rules that happen to agree) was raised as worth considering, but is not required by this issue.

### Not urgent

Requires a ULID written mid-line or wrapped in emphasis rather than plainly at line end. No user-visible breakage is known — unlike #124's gap, which was live in `demo-notebook`. Filed so the reasoning isn't lost, not because anything is on fire.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A badged ULID is always resolvable (Priority: P1)

**Status: contingent on Open Question 1 (Direction).** Written for Direction 1 (collapse Branch A into Branch B); does not apply if Direction 2 is chosen.

As an editor user, when a ULID-shaped block anchor renders as a badge, I want that badge to always correspond to something `[[file#^id]]` can actually resolve, so the badge is a reliable promise rather than sometimes-true UI decoration.

**Why this priority**: This is the defect this issue exists to fix — the badge currently overclaims resolvability for ULIDs, mirroring (in reverse) the defect #124 fixes for non-ULID ids.

**Independent Test**: Write a ULID mid-line (`The decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and continues.`) and confirm it no longer renders as a badge; write the same ULID at line end and confirm it still does.

**Acceptance Scenarios**:

1. **Given** a line containing `^01M00VDX0S4JHMDNA7F776Y8R8` followed by further prose on the same line, **When** the editor renders it, **Then** it does NOT display as a block-anchor badge (matches Branch B's existing behavior for every other id form).
2. **Given** a line ending in `^01M00VDX0S4JHMDNA7F776Y8R8` (optionally preceded by other content, e.g. a checkbox item), **When** the editor renders it, **Then** it continues to display as a badge (no regression for the real-authoring shape).
3. **Given** `checkbox-anchor.md` (the one #122 fixture whose ULID is already at line end), **When** the round-trip suite runs, **Then** it still passes unchanged.

Note: if Direction 1 is chosen, the unified position rule applied here must incorporate the symmetric-wrapper allowance from User Story 2 below (not the original, narrower resolver rule quoted above), since a ULID wrapped in emphasis at line end must still badge under a single, universal rule.

---

### User Story 2 - Badge a wrapped anchor consistently with the widened resolver (Priority: P1)

**Status: resolved — applies regardless of Open Question 1.**

As an editor user, when I wrap a block anchor's id in a single level of emphasis or strong emphasis at the end of a line (`**^id**`, `_^id_`), I want it to badge if and only if `verveguy/liminis#1114`'s widened resolver would resolve it, so the two components stay in agreement for this shape the same way #124 achieves for the unwrapped case.

**Why this priority**: Without this, widening the resolver alone (verveguy/liminis#1114) creates new badge/resolver disagreements for non-ULID ids even as it fixes the ULID case — a net-zero trade, not a fix.

**Independent Test**: Write `**^a1b2c3**` (a non-ULID id wrapped in strong emphasis) at line end and confirm it now badges; confirm `squared *^2*` also badges (an accepted residual, not a regression) and that a caret inside math/code remains excluded.

**Acceptance Scenarios**:

1. **Given** a line ending in `**^a1b2c3**` (a short alphanumeric id wrapped in strong emphasis), **When** the editor renders it, **Then** it displays as a block-anchor badge (matching `verveguy/liminis#1114`'s widened resolver, which now resolves this shape).
2. **Given** a line ending in `_^01M00VDX0S4JHMDNA7F776Y8R8_` (a ULID wrapped in emphasis), **When** the editor renders it, **Then** it continues to badge (already true via Branch A, no code change needed there) and is confirmed to resolve under `verveguy/liminis#1114`.
3. **Given** a line ending in `*^2*` (a single-digit id wrapped in emphasis), **When** the editor renders it under the widened rule, **Then** it badges — an accepted residual false anchor, consistent with the already-accepted `^100` residual, not a defect to fix.
4. **Given** an asymmetric wrapper (e.g. `*^id**` or `**^id*`), **When** the editor renders it, **Then** its badge/no-badge outcome matches `verveguy/liminis#1114`'s tested behavior for the same input exactly.

---

### Edge Cases

- `multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` currently place their ULID mid-line or immediately before further inline content. Under Direction 1, these fixtures stop badging as written; if Direction 1 is chosen, they need rewriting so the ULID sits at line end, preserving what they actually test (paragraph-level multiple-anchor handling, adjacency to a preceding wiki-link, emphasis-marker round-tripping) rather than asserting a shape the resolver can never address.
- `checkbox-anchor-formatted.md` no longer needs rewriting: once the resolver widens (`verveguy/liminis#1114`) and Branch B gains the matching wrapper allowance, both of its anchors badge and resolve as written.
- `squared *^2*`-shaped input becomes a badged *and* resolved false anchor once the wrapper allowance ships. This is an accepted residual, the same class as the `^100` residual #124's spec already accepted, and must be recorded in ADR-122's amendment rather than discovered later.
- `anchor-in-code-not-badged.md` and `anchor-in-math-not-badged.md` are unaffected either way: code and math exclusion is structural (separate mdast node types), independent of position rule or wrapper allowance.
- `truncated-malformed-id.md` and `non-anchor-carets.md` are unaffected either way: they exercise charset/length boundaries, not position or wrapping.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This issue MUST resolve Open Question 1 (below) before implementation: either (a) the badge detector's ULID branch adopts the same end-of-line position constraint as every other id form, or (b) Branch A is kept exactly as #124 designed it and this issue produces a documentation-only change recording that decision.
- **FR-002** *(applies only if Direction 1 is chosen)*: A ULID-shaped block anchor MUST be badged if and only if it satisfies the same position rule already applied to every other id form (caret starts a token; captured id runs to end of line, trailing whitespace or one level of matching emphasis/strong-emphasis wrapper permitted per FR-006).
- **FR-003** *(applies only if Direction 1 is chosen)*: `roundtrip/122-block-anchor/multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` MUST be rewritten so each ULID sits at line end, continuing to exercise the same parser behavior (multiple anchors per paragraph, adjacency to a wiki-link, emphasis-marker round-tripping) the original fixture targeted.
- **FR-004**: ADR-122 MUST be amended (not rewritten, per this repository's ADR convention) to record: this issue's Direction 1/2 resolution and reasoning; the decision to widen the resolver (`verveguy/liminis#1114`) rather than accept the badge/resolver disagreement on `checkbox-anchor-formatted.md`; the net-zero table showing why a resolver-only change was rejected; and the accepted `*^2*`-class residual.
- **FR-005**: Whichever Direction is chosen, the full `roundtrip/122-block-anchor/` fixture suite MUST pass, plus new fixtures covering the wrapped non-ULID anchor case (FR-006), and no fixture's assertion may silently change meaning without an explicit rewrite justified in the ADR amendment.
- **FR-006**: Branch B MUST accept a block anchor wrapped in one level of matching emphasis/strong-emphasis markers (`*id*`, `_id_`, `**id**`, `__id__`) immediately preceding end of line, for every id form Branch B already accepts — matching the widened resolver rule filed at `verveguy/liminis#1114`.
- **FR-007**: The wrapped-anchor rule implemented for FR-006 MUST match `verveguy/liminis#1114`'s tested pattern case-for-case, including its accepted flaws (a single-character wrapped digit such as `*^2*` resolves and badges as a false anchor; an asymmetric wrapper's capture behavior matches), so badge and resolver do not drift out of agreement again.

### Key Entities

Not applicable — no new data entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every mid-line ULID badge/resolver disagreement this issue identifies is either eliminated (Direction 1) or explicitly and permanently documented as an accepted gap (Direction 2), with no case left ambiguous.
- **SC-002**: The `122-block-anchor` fixture corpus, plus new wrapped-anchor fixtures, pass in full after this issue's changes.
- **SC-003**: A reader of ADR-122 after this issue ships can determine, without consulting this issue's history, why the ULID branch has the position behavior it has, and why the wrapped-anchor allowance exists.
- **SC-004**: A non-ULID anchor wrapped in matching emphasis/strong markers at line end badges consistently with the widened resolver (`verveguy/liminis#1114`) — no cross-repo disagreement remains for the wrapped-anchor shape.

## Assumptions

- The resolver's core position rule (`verveguy/liminis`'s `fs.ts`, `verveguy/liminis#1109`) remains out of this issue's direct control — it lives in a separate repository. Its wrapper-allowance widening (`verveguy/liminis#1114`) is a prerequisite this issue's Branch B change must mirror case-for-case; this issue does not itself modify `verveguy/liminis` code.
- This issue's design vocabulary ("Branch A", "Branch B") describes #124's implementation as currently written on `fabrik/issue-124` (commit `859e8f40`), which is at the Validate stage with a merge pending. If that implementation changes materially before this issue is implemented, this spec's references to specific branch behavior should be re-verified against its actual merged state.
- A single-character wrapped digit resolving and badging as a false anchor (e.g. `*^2*`) is an accepted residual once FR-006 ships, on the same reasoning already accepted for the `^100` residual: a length floor high enough to exclude it would also exclude legitimate short alphanumeric ids.

## Out of Scope

- Directly modifying `verveguy/liminis`'s resolver code — tracked separately as `verveguy/liminis#1114` — though this issue's Branch B implementation (FR-006/FR-007) must be coordinated with, and match, that change.
- Migrating or changing how `liminis-framework`'s actions tooling writes anchors.
- Building a single shared fixture list asserted against by both repositories — raised as worth considering, not required by this issue.

## Source References

- Issue #122 (original ULID-only badge decision), `docs/decisions/adr-122-block-anchor-badge.md`
- Issue #124 (widens non-ULID detection; introduces the Branch A/Branch B split this issue reasons about), `fabrik/issue-124` / PR #125 (Validate stage, merge pending)
- `verveguy/liminis#1109` (original resolver rule, merged, separate repository) — `/(?:^|\s)\^([^\s\]#]+)\s*$/`
- `verveguy/liminis#1114` (resolver widened to accept a symmetrically-wrapped anchor at line end; `liminis-app/src/main/fs.ts:817`, `ANCHOR_LINE_PATTERN`) — Branch B's FR-006/FR-007 must match this case-for-case
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the fixture corpus this issue reasons about)

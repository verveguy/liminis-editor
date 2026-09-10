# Feature Specification: Reconcile the ULID Badge Branch With the Resolver's Position Rule

**Feature Branch**: `fabrik/issue-126`
**Created**: 2026-09-09
**Status**: Draft
**Input**: User description: "Branch A badges ULID anchor shapes the resolver can never address"

## Background

Follow-up split out of #124 so it doesn't widen that PR's scope. Pre-existing from #122 — #124 neither introduces nor worsens it. #124 is still an open, unmerged PR (`fabrik/issue-124`) at the time this issue was filed; its design is what this issue reasons about.

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

**This is Open Question 1, and it is still unresolved.**

### The emphasis-wrapped case — resolved: widen the resolver, and this issue's scope grows

`checkbox-anchor-formatted.md` was flagged separately from the other four:

```
- [ ] @me Draft the boundary doc by 2026-09-15 **^01M00VDX0S4JHMDNA7F776Y8R8**
- [ ] @me A second item with an italic anchor _^01M00VDX0S4JHMDNA7F776Y8R9_
```

A bold- or italic-wrapped anchor at line end is a plausible thing a user would type. It badges today but does not resolve, because the resolver's regex requires the caret to be preceded by whitespace, not `*`/`_`.

**Decision (2026-09-09): the resolver is the wrong side here, and it will be widened.** Filed as `verveguy/liminis#1114` (`liminis-app/src/main/fs.ts:817`, `ANCHOR_LINE_PATTERN`).

That decision **cannot be a resolver-only change**, which pulls scope back into this issue. Badge behaviour on `fabrik/issue-124` (`859e8f40`), measured against both the current and a widened resolver rule:

| case | badge | resolver now | resolver widened |
|---|---|---|---|
| `item **^<ULID>**` | badges | no — disagree | yes — agree |
| `item _^<ULID>_` | badges | no — disagree | yes — agree |
| `item **^a1b2c3**` | no badge | no — agree | yes — **new disagreement** |
| `squared *^2*` | no badge | no — agree | yes — **new false anchor** |
| `item ^<ULID>` | badges | yes — agree | yes — agree |
| `item ^a1b2c3` | badges | yes — agree | yes — agree |

Widening only the resolver is net-zero: it fixes two disagreements and creates two more. The reason: `**^<ULID>**` badges only via Branch A (ULID, position-free), while Branch B requires whitespace before the `^` — so a wrapped *non*-ULID id would resolve without ever badging once the resolver widens alone.

**So Branch B needs the same symmetric-wrapper allowance, landing together with `verveguy/liminis#1114`.** Neither side should merge alone. This is now in scope for this issue — previously it was expected to belong entirely to the other repository.

One consequence follows deliberately: once both sides accept wrappers, `squared *^2*` becomes a badged *and* resolved false anchor. That is the same class of residual as the `^100` false positive #124's spec already accepted (a length/charset floor would break legitimate short ids like `^a1b2c3`), so accepting it is consistent — but it must be recorded in the ADR-122 amendment rather than discovered later.

A related idea, not decided and not required by this issue: a single shared fixture list that both this repository and `verveguy/liminis` assert against, so the two rules can't drift apart silently the way they did here. Left as a future consideration.

### Not urgent

Requires a ULID written mid-line, or an id wrapped in emphasis, rather than plainly at line end. No user-visible breakage is known — unlike #124's gap, which was live in `demo-notebook`. Filed so the reasoning isn't lost, not because anything is on fire.

## User Scenarios & Testing *(mandatory)*

User Story 1 is written for **Direction 1** (collapse Branch A into Branch B) and depends on Open Question 1. User Story 2 is independent of that question — it follows from the emphasis-wrapper decision above and applies either way.

### User Story 1 - A badged ULID is always resolvable (Priority: P1)

As an editor user, when a ULID-shaped block anchor renders as a badge, I want that badge to always correspond to something `[[file#^id]]` can actually resolve, so the badge is a reliable promise rather than sometimes-true UI decoration.

**Why this priority**: This is the defect this issue exists to fix — the badge currently overclaims resolvability for ULIDs, mirroring (in reverse) the defect #124 fixes for non-ULID ids.

**Independent Test**: Write a ULID mid-line (`The decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and continues.`) and confirm it no longer renders as a badge; write the same ULID at line end and confirm it still does.

**Acceptance Scenarios**:

1. **Given** a line containing `^01M00VDX0S4JHMDNA7F776Y8R8` followed by further prose on the same line, **When** the editor renders it, **Then** it does NOT display as a block-anchor badge (matches Branch B's existing behavior for every other id form).
2. **Given** a line ending in `^01M00VDX0S4JHMDNA7F776Y8R8` (optionally preceded by other content, e.g. a checkbox item), **When** the editor renders it, **Then** it continues to display as a badge (no regression for the real-authoring shape).
3. **Given** `checkbox-anchor.md` (the one #122 fixture whose ULID is already at line end), **When** the round-trip suite runs, **Then** it still passes unchanged.

---

### User Story 2 - An emphasis-wrapped anchor that badges also resolves (Priority: P1)

As an editor user, when I wrap a block anchor's caret and id in matching bold or italic markers (e.g. `**^01M00VDX0S4JHMDNA7F776Y8R8**`), I want it to both badge and resolve consistently, so the badge's promise holds regardless of whether the id happens to be a ULID.

**Why this priority**: Decided 2026-09-09 — the resolver will widen to accept a symmetric emphasis wrapper (`verveguy/liminis#1114`). Landing that change alone creates two *new* badge/resolver disagreements (a wrapped non-ULID id would resolve without ever badging). Branch B must widen in lockstep, matching liminis#1114's rule case-for-case, or the two sides drift apart again — the exact failure #124 exists to fix.

**Independent Test**: With the widened resolver and widened Branch B both in place: (a) `item **^01M00VDX0S4JHMDNA7F776Y8R8**` badges and resolves; (b) `item _^01M00VDX0S4JHMDNA7F776Y8R9_` badges and resolves; (c) `item **^a1b2c3**` (non-ULID, wrapped) badges and resolves; (d) `squared *^2*` badges and resolves too — an accepted false positive, same class as the existing `^100` residual, not a defect to fix here.

**Acceptance Scenarios**:

1. **Given** a non-ULID id wrapped in matching bold or italic markers at line end, **When** the widened resolver (`verveguy/liminis#1114`) is available, **Then** Branch B badges it (previously it did not).
2. **Given** an asymmetric or malformed wrapper (per the flaws `verveguy/liminis#1114` documents), **When** the editor evaluates it, **Then** Branch B's behavior matches the widened resolver's rule case-for-case, not a looser or stricter approximation.
3. **Given** `checkbox-anchor-formatted.md`, **When** both sides of the wrapper widening have landed, **Then** the fixture's expectation changes from "badges but does not resolve" to "badges and resolves" — an intentional, ADR-documented change in what this fixture asserts.

---

### Edge Cases

- `multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` currently place their ULID mid-line or immediately before further inline content. Under Direction 1, these fixtures stop badging as written; if Direction 1 is chosen, they need rewriting so the ULID sits at line end, preserving what they actually test (paragraph-level multiple-anchor handling, adjacency to a preceding wiki-link, emphasis-marker round-tripping) rather than asserting a shape the resolver can never address.
- `checkbox-anchor-formatted.md` (bold/italic-wrapped anchor at line end): its expected outcome changes from "badges but does not resolve" to "badges and resolves" once the resolver widening (`verveguy/liminis#1114`) and Branch B's matching widening both land. This is a deliberate, decided change in what the fixture asserts, not a silent drift, and must be called out in the ADR-122 amendment per FR-005.
- `squared *^2*`: once wrapper support lands on both sides, this becomes a badged *and* resolved false anchor (id `2`). Accepted on the same grounds as the existing `^100` residual — see FR-008.
- `anchor-in-code-not-badged.md` and `anchor-in-math-not-badged.md` are unaffected either way: code and math exclusion is structural (separate mdast node types), independent of which position rule ULID uses.
- `truncated-malformed-id.md` and `non-anchor-carets.md` are unaffected either way: they exercise charset/length boundaries, not position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This issue MUST resolve Open Question 1 (below) before implementation: either (a) the badge detector's ULID branch adopts the same end-of-line position constraint as every other id form, or (b) Branch A is kept exactly as #124 designed it and this issue produces a documentation-only change recording that decision.
- **FR-002** *(applies only if Direction 1 is chosen)*: A ULID-shaped block anchor MUST be badged if and only if it satisfies the same position rule already applied to every other id form (caret starts a token; captured id runs to end of line, trailing whitespace permitted).
- **FR-003** *(applies only if Direction 1 is chosen)*: `roundtrip/122-block-anchor/multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` MUST be rewritten so each ULID sits at line end, continuing to exercise the same parser behavior (multiple anchors per paragraph, adjacency to a wiki-link, emphasis-marker round-tripping) the original fixture targeted.
- **FR-004**: ADR-122 MUST be amended (not rewritten, per this repository's ADR convention) to record this issue's Open Question 1 resolution and reasoning, whichever direction is chosen.
- **FR-005**: Whichever direction is chosen for Open Question 1, the full `roundtrip/122-block-anchor/` fixture suite MUST pass, and no fixture's assertion may silently change meaning without an explicit rewrite justified in the ADR-122 amendment.
- **FR-006** *(applies regardless of Open Question 1's outcome — decided 2026-09-09)*: Branch B (the non-ULID id detection #124 introduces) MUST be widened to accept a symmetric emphasis wrapper (`**...**` or `_..._`) around the caret and id, matching the rule `verveguy/liminis#1114` proposes for the resolver, so that the resolver's wrapper widening does not create a new badge/resolver disagreement (a wrapped non-ULID id resolving without ever badging).
- **FR-007**: This issue's Branch B wrapper widening and `verveguy/liminis#1114`'s resolver widening MUST be treated as a matched pair — landing one without the other reintroduces disagreement (see the measured matrix in Background), so implementation must account for the two repositories' independent release cadences (e.g. feature-gating, or accepting a temporary window of disagreement, whichever Plan decides).
- **FR-008**: ADR-122's amendment (FR-004) MUST additionally record the residual that wrapper support creates: a wrapped, non-ULID id that reads as ordinary formatting (e.g. `squared *^2*`) becomes both badged and resolved as a false anchor. This is accepted on the same grounds as the existing `^100` residual (a length/charset floor would break legitimate short ids).

### Key Entities

Not applicable — no new data entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every badge/resolver disagreement this issue identifies for ULID position is either eliminated (Direction 1) or explicitly and permanently documented as an accepted gap (Direction 2), with no case left ambiguous.
- **SC-002**: The `122-block-anchor` fixture corpus passes in full after this issue's changes.
- **SC-003**: A reader of ADR-122 after this issue ships can determine, without consulting this issue's history, why the ULID branch has the position behavior it has, why Branch B accepts symmetric emphasis wrappers, and why `^100`-class and `squared *^2*`-class false positives are accepted residuals.
- **SC-004**: Once both `verveguy/liminis#1114` and this issue's Branch B change have landed, the emphasis-wrapper matrix in Background shows agreement (not disagreement) for every row.

## Assumptions

- The resolver (`verveguy/liminis`'s `fs.ts`, `verveguy/liminis#1109`, soon to be widened by `verveguy/liminis#1114`) is out of this issue's control in the sense that this repository cannot merge changes to it — but this issue's scope now includes making Branch B match `verveguy/liminis#1114`'s rule case-for-case (see FR-006–FR-008).
- This issue's design vocabulary ("Branch A", "Branch B") describes #124's implementation as currently written on the unmerged `fabrik/issue-124` branch. If #124's implementation changes before this issue is implemented, this spec's references to specific branch behavior should be re-verified against #124's actual merged state.
- A shared fixture list asserted against by both this repository and `verveguy/liminis` has been raised as a way to prevent future drift, but is not decided and not required by this issue.

## Out of Scope

- Implementing the resolver-side widening itself — that is `verveguy/liminis#1114`, in the separate `verveguy/liminis` repository. This issue only needs Branch B to match its rule.
- The *position* gating Branch B already has from #124 (caret must start a token, id runs to end of line) — unchanged by this issue except for the wrapper allowance in FR-006.
- Migrating or changing how `liminis-framework`'s actions tooling writes anchors.
- Building a shared fixture list between this repository and `verveguy/liminis` (see Assumptions) — a future idea, not required here.

## Open Questions

- [ ] **Q1 — Direction**: Should the badge detector's ULID branch be widened to require the same end-of-line position as every other id form, collapsing #124's two-branch design into one universal rule (Direction 1 — requires rewriting `multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` to move their ULIDs to line end)? Or should Branch A remain deliberately permissive exactly as #124 designed it, with this issue producing only a documentation update (Direction 2 — no code or fixture change)?
- [ ] **Q3 — Sequencing**: This issue's target state is expressed in terms of the Branch A/Branch B split #124 introduces, but #124 (`fabrik/issue-124`, PR #125) has not yet merged to `main`. Should Research/Plan for this issue proceed now against #124's branch state (accepting that a rebase may be needed once #124 merges), or should this issue wait until #124 has merged to `main` before continuing past Specify? This also affects sequencing against `verveguy/liminis#1114`, which lives in a different repository with its own release cadence — should this issue's Branch B change be implemented and merged ahead of the resolver widening (accepting a temporary window where Branch B accepts wrappers the resolver doesn't yet resolve), or held until `verveguy/liminis#1114` ships?

## Source References

- Issue #122 (original ULID-only badge decision), `docs/decisions/adr-122-block-anchor-badge.md`
- Issue #124 (widens non-ULID detection; introduces the Branch A/Branch B split this issue reasons about), `fabrik/issue-124` / PR #125 (open, unmerged)
- `verveguy/liminis#1109` (resolver, merged, separate repository) — `/(?:^|\s)\^([^\s\]#]+)\s*$/`
- `verveguy/liminis#1114` (resolver widening to accept a symmetric emphasis wrapper, separate repository, not yet merged)
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the fixture corpus this issue reasons about)

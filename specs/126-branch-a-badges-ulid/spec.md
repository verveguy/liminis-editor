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

### The one case that deserves separate thought

`checkbox-anchor-formatted.md` is different from the others:

```
- [ ] @me Draft the boundary doc by 2026-09-15 **^01M00VDX0S4JHMDNA7F776Y8R8**
- [ ] @me A second item with an italic anchor _^01M00VDX0S4JHMDNA7F776Y8R9_
```

A bold- or italic-wrapped anchor at line end **is** a plausible thing a user would type, and it badges today but does not resolve — the resolver's regex requires the caret to be preceded by whitespace, not `*`/`_`. Here the resolver is arguably the side that's wrong, but the resolver lives in a different repository (`verveguy/liminis`) that this issue cannot itself change.

### Not urgent

Requires a ULID written mid-line or wrapped in emphasis rather than plainly at line end. No user-visible breakage is known — unlike #124's gap, which was live in `demo-notebook`. Filed so the reasoning isn't lost, not because anything is on fire.

## User Scenarios & Testing *(mandatory)*

The scenarios below are written for **Direction 1** (collapse Branch A into Branch B). If Open Question 1 is answered the other way, this issue produces no behavior change and User Story 1 does not apply — see Open Questions.

### User Story 1 - A badged ULID is always resolvable (Priority: P1)

As an editor user, when a ULID-shaped block anchor renders as a badge, I want that badge to always correspond to something `[[file#^id]]` can actually resolve, so the badge is a reliable promise rather than sometimes-true UI decoration.

**Why this priority**: This is the defect this issue exists to fix — the badge currently overclaims resolvability for ULIDs, mirroring (in reverse) the defect #124 fixes for non-ULID ids.

**Independent Test**: Write a ULID mid-line (`The decision was recorded here ^01M00VDX0S4JHMDNA7F776Y8R8 and continues.`) and confirm it no longer renders as a badge; write the same ULID at line end and confirm it still does.

**Acceptance Scenarios**:

1. **Given** a line containing `^01M00VDX0S4JHMDNA7F776Y8R8` followed by further prose on the same line, **When** the editor renders it, **Then** it does NOT display as a block-anchor badge (matches Branch B's existing behavior for every other id form).
2. **Given** a line ending in `^01M00VDX0S4JHMDNA7F776Y8R8` (optionally preceded by other content, e.g. a checkbox item), **When** the editor renders it, **Then** it continues to display as a badge (no regression for the real-authoring shape).
3. **Given** `checkbox-anchor.md` (the one #122 fixture whose ULID is already at line end), **When** the round-trip suite runs, **Then** it still passes unchanged.

---

### Edge Cases

- `multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` currently place their ULID mid-line or immediately before further inline content. Under Direction 1, these fixtures stop badging as written; if Direction 1 is chosen, they need rewriting so the ULID sits at line end, preserving what they actually test (paragraph-level multiple-anchor handling, adjacency to a preceding wiki-link, emphasis-marker round-tripping) rather than asserting a shape the resolver can never address.
- `checkbox-anchor-formatted.md` (bold/italic-wrapped anchor at line end) already fails to resolve today, for a different reason (the resolver's whitespace-before-`^` requirement, not position-on-line) that is outside this issue's control — see Open Question 2.
- `anchor-in-code-not-badged.md` and `anchor-in-math-not-badged.md` are unaffected either way: code and math exclusion is structural (separate mdast node types), independent of which position rule ULID uses.
- `truncated-malformed-id.md` and `non-anchor-carets.md` are unaffected either way: they exercise charset/length boundaries, not position.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This issue MUST resolve Open Question 1 (below) before implementation: either (a) the badge detector's ULID branch adopts the same end-of-line position constraint as every other id form, or (b) Branch A is kept exactly as #124 designed it and this issue produces a documentation-only change recording that decision.
- **FR-002** *(applies only if Direction 1 is chosen)*: A ULID-shaped block anchor MUST be badged if and only if it satisfies the same position rule already applied to every other id form (caret starts a token; captured id runs to end of line, trailing whitespace permitted).
- **FR-003** *(applies only if Direction 1 is chosen)*: `roundtrip/122-block-anchor/multiple-anchors.md`, `anchor-after-wikilink.md`, and `anchor-in-emphasis-strong.md` MUST be rewritten so each ULID sits at line end, continuing to exercise the same parser behavior (multiple anchors per paragraph, adjacency to a wiki-link, emphasis-marker round-tripping) the original fixture targeted.
- **FR-004**: ADR-122 MUST be amended (not rewritten, per this repository's ADR convention) to record this issue's resolution and reasoning, whichever direction is chosen.
- **FR-005**: Whichever direction is chosen, the full `roundtrip/122-block-anchor/` fixture suite MUST pass, and no fixture's assertion may silently change meaning without an explicit rewrite justified in the ADR amendment.

### Key Entities

Not applicable — no new data entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every badge/resolver disagreement this issue identifies is either eliminated (Direction 1) or explicitly and permanently documented as an accepted gap (Direction 2), with no case left ambiguous.
- **SC-002**: The `122-block-anchor` fixture corpus passes in full after this issue's changes.
- **SC-003**: A reader of ADR-122 after this issue ships can determine, without consulting this issue's history, why the ULID branch has the position behavior it has.

## Assumptions

- The resolver (`verveguy/liminis`'s `fs.ts`, `verveguy/liminis#1109`) is out of this issue's control — it lives in a separate repository. Any change to the resolver itself is out of scope here (see Open Question 2).
- This issue's design vocabulary ("Branch A", "Branch B") describes #124's implementation as currently written on the unmerged `fabrik/issue-124` branch. If #124's implementation changes before this issue is implemented, this spec's references to specific branch behavior should be re-verified against #124's actual merged state.

## Out of Scope

- Any change to the resolver's regex or behavior in `verveguy/liminis`.
- Any change to non-ULID id detection (Branch B), which #124 already makes position-gated.
- Migrating or changing how `liminis-framework`'s actions tooling writes anchors.

## Source References

- Issue #122 (original ULID-only badge decision), `docs/decisions/adr-122-block-anchor-badge.md`
- Issue #124 (widens non-ULID detection; introduces the Branch A/Branch B split this issue reasons about), `fabrik/issue-124` / PR #125 (open, unmerged)
- `verveguy/liminis#1109` (resolver, merged, separate repository) — `/(?:^|\s)\^([^\s\]#]+)\s*$/`
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` (the fixture corpus this issue reasons about)

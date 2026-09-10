# Feature Specification: Widen Branch B to Badge Emphasis-Wrapped Block Anchors

**Feature Branch**: `fabrik/issue-127`
**Created**: 2026-09-09
**Status**: Specified
**Input**: User description: "Widen Branch B to badge emphasis-wrapped block anchors (pairs with liminis#1114)"

## Background

Split out of #126 so the settled half of that issue can be built while the
unsettled half (whether to collapse Branch A into Branch B) waits on Brett's
answer. **This issue must land together with `verveguy/liminis#1114` —
neither side may merge alone.**

`src/markdown/parse.ts`'s block-anchor badge detector (introduced by #122,
widened by #124 into two branches — **Branch A**, the frozen,
position-unconstrained ULID rule, and **Branch B**, every other id shape,
gated by the resolver's `/(?:^|\s)\^([^\s\]#]+)\s*$/` position rule) rejects
an anchor wrapped in emphasis at line end via Branch B, because Branch B
requires the `^` to be preceded by whitespace or line start:

```
- [ ] @me Draft the boundary doc by 2026-09-15 **^01M00VDX0S4JHMDNA7F776Y8R8**
```

Brett's decision on #126 is that the **resolver** is the wrong side to fix
this shape on — the badge is right to show it. `verveguy/liminis#1114`
widens the resolver's `ANCHOR_LINE_PATTERN` to accept a symmetric emphasis
wrapper around the id. Branch B must widen in lockstep, or badge and
resolver drift apart again in the opposite direction from the defect #124
fixed.

### Why this cannot be the resolver alone

Measured on `fabrik/issue-124` (`859e8f40`), badge vs. current and widened
resolver:

| case | badge | resolver now | resolver widened |
|---|---|---|---|
| `item **^<ULID>**` | badges | no — **disagree** | yes — agree |
| `item _^<ULID>_` | badges | no — **disagree** | yes — agree |
| `item **^a1b2c3**` | no badge | no — agree | yes — **new disagreement** |
| `squared *^2*` | no badge | no — agree | yes — **new false anchor** |
| `item ^<ULID>` | badges | yes — agree | yes — agree |
| `item ^a1b2c3` | badges | yes — agree | yes — agree |

`**^<ULID>**` badges today only via **Branch A**, which carries no position
constraint. Branch B still demands whitespace before the caret, so a
wrapped *non*-ULID id (e.g. `**^a1b2c3**`) would resolve under the widened
resolver without ever badging — reintroducing #124's defect pointing the
other way. Widening the resolver alone is net-zero: two disagreements fixed,
two created. Widening Branch B to match closes the gap without reopening it
elsewhere.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A symmetric emphasis wrapper around a line-end anchor badges (Priority: P1)

As an editor user, when I write a block anchor at the end of a line wrapped
in matching emphasis markers (`**id**`, `__id__`, `*id*`, or `_id_`), I want
it to render as a badge — without the wrapper characters showing inside the
badge — so the badge reflects what the (equally widened) resolver will treat
as a valid reference target, for both ULID and non-ULID id shapes.

**Why this priority**: This is the core defect the issue exists to fix.
Without it, widening the resolver alone (`liminis#1114`) creates a new
badge/resolver disagreement for non-ULID ids wrapped in emphasis.

**Independent Test**: Given a line ending in `**^a1b2c3**` or `_^a1b2c3_`,
confirm it renders as a block-anchor badge showing `a1b2c3`, matching what
the widened resolver would resolve.

**Acceptance Scenarios**:

1. **Given** a line ending in `**^a1b2c3**` (a non-ULID id wrapped in bold),
   **When** the editor renders it, **Then** it displays as a block-anchor
   badge for id `a1b2c3`, with no `**` visible.
2. **Given** a line ending in `_^a1b2c3_` (wrapped in italic using
   underscore), **When** rendered, **Then** it displays as a badge for
   `a1b2c3`.
3. **Given** the unwrapped form `item ^a1b2c3` (already badging today),
   **When** rendered, **Then** it continues to badge unchanged (no
   regression from routing through the same widened branch).

---

### User Story 2 - Existing wrapped-ULID fixture keeps round-tripping and starts badging (Priority: P1)

As a maintainer, I want the pre-existing
`roundtrip/122-block-anchor/checkbox-anchor-formatted.md` fixture — a
bold-wrapped and an italic-wrapped ULID, each at end of line — to keep
round-tripping byte-identically, and to badge under the same widened rule
that badges non-ULID wrapped ids.

**Why this priority**: This fixture already exists and already exercises
the exact real-authoring shape (`- [ ] ... **^ULID**`) the issue's own
example is drawn from; it must not regress, and its behavior is the
clearest acceptance signal for FR-1.

**Independent Test**: Run the round-trip suite against
`checkbox-anchor-formatted.md` and confirm both lines badge and the
document's source is byte-identical after `parseMarkdown` →
`stringifyMarkdown`.

**Acceptance Scenarios**:

1. **Given** `checkbox-anchor-formatted.md`'s first line (`**^ULID**` at end
   of a checkbox item), **When** parsed and re-stringified, **Then** the
   output is byte-identical to the input and the anchor renders as a badge.
2. **Given** the same fixture's second line (`_^ULID_`), **When** parsed and
   re-stringified, **Then** the same holds.

---

### Edge Cases

- **`squared *^2*` becomes a badged and resolved false anchor.** This is the
  same class of residual #124's spec already considered and accepted for
  `^100` at line end: any length floor that would exclude this also excludes
  legitimate short ids like `^a1b2c3`. Accepted deliberately, and recorded
  in the ADR-122 amendment (FR-6) rather than left as an undocumented
  surprise.
- **Asymmetric wrappers must not mis-capture the id.** `item **^<ULID>_`
  (opening `**`, closing `_`) must not badge with a corrupted id such as
  `<ULID>_`. An unbalanced wrapper is rejected rather than partially
  matched.
- **Other wrapper forms stay unresolved and unbadged.** `***…***` (bold +
  italic combined), `~~…~~` (strikethrough), backtick-wrapped
  (`` `^id` ``), and paren-wrapped (`(^id)`) forms are explicitly out of
  scope — not handled generally, and not silently assumed to work by a
  future reader.
- **Mid-line anchors remain untouched.** An anchor not at the end of a line
  — wrapped or not — stays governed by existing Branch B/Branch A behavior;
  this issue does not change mid-line detection (that is #126's territory).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-1**: Branch B MUST accept a symmetric emphasis wrapper (`**`, `__`,
  `*`, `_`) around `^<id>` at the end of a line, badging the id **without**
  the wrapper characters appearing in or around the badge.
- **FR-2**: Branch B's accept/reject behavior MUST match
  `verveguy/liminis#1114`'s `ANCHOR_LINE_PATTERN` case-for-case. The
  reference pattern, tested there against 17 cases including the id-only
  strip path:
  ```
  /(?:^|\s)(\*\*|__|\*|_)?\^([^\s\]#]+?)\1?\s*$/
  ```
  A backreference to a non-participating group matches empty in JS, so the
  unwrapped form still goes through the same branch.
- **FR-3**: Round-trip MUST stay byte-identical.
  `roundtrip/122-block-anchor/checkbox-anchor-formatted.md` already exists
  as a fixture and must keep round-tripping unchanged, and it MUST now also
  badge both of its anchors (see User Story 2).
- **FR-4**: No regression in #124's test suite: every case in the `SC-005`
  resolver-agreement test MUST keep passing, and the empty-capture guard
  tests MUST keep biting.
- **FR-5**: Branch A MUST NOT be touched. Mid-line anchors stay out of scope
  (that is #126's territory).
- **FR-6**: ADR-122 MUST be amended (not rewritten, per this repository's
  ADR convention — see `docs/decisions/adr-122-block-anchor-badge.md` and
  its existing amendment precedent) to record that:
  1. Branch B now accepts a symmetric emphasis wrapper at line end, and why
     (resolver parity, per this issue).
  2. `squared *^2*` becoming a badged-and-resolved false anchor is accepted
     deliberately, for the same reason a minimum-length floor was already
     rejected for `^100` (excluding it would also exclude legitimate short
     ids).
  3. Asymmetric wrappers are rejected rather than captured with a corrupted
     id, and wrapper forms other than `**`/`__`/`*`/`_` (triple emphasis,
     strikethrough, backtick, parens) remain unhandled by design, not by
     oversight.

### Key Entities *(if the feature involves data)*

Not applicable — no new data entities; this widens an existing detection
rule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-ULID id (e.g. `a1b2c3`) wrapped in `**`, `__`, `*`, or
  `_` at line end renders as a badge, matching what the widened resolver
  (`liminis#1114`) would resolve.
- **SC-002**: `checkbox-anchor-formatted.md`'s two ULID anchors (bold- and
  italic-wrapped) both render as badges, and the fixture round-trips
  byte-identically.
- **SC-003**: An asymmetric wrapper (e.g. `**^<ULID>_`) never badges with a
  corrupted id.
- **SC-004**: The full `#124` regression suite — the `SC-005`
  resolver-agreement cases and the empty-capture guard tests — passes
  unchanged.
- **SC-005**: `docs/decisions/adr-122-block-anchor-badge.md` carries a dated
  amendment documenting this issue's resolution and the three accepted
  consequences (FR-6).

## Assumptions

- **This issue depends on #124's Branch A/Branch B split.** As of this
  writing, `fabrik/issue-124` (PR #125) — which introduces
  `findBlockAnchorMatches` and the Branch A/Branch B split this issue
  modifies — is implemented and review-complete but not yet merged to
  `main`. This spec assumes #124 has merged (or this branch has been
  rebased onto it) before Research/Plan/Implement proceed; Branch B does
  not exist on `main` today.
- **This issue's resolution does not depend on #126's open question.** #126
  asks whether Branch A (ULID, no position constraint) should adopt the
  position rule too. That question is orthogonal to Branch B's wrapper
  handling and can resolve independently in either direction without
  changing this issue's requirements.
- **The exact mechanism for matching `liminis#1114`'s regex case-for-case is
  a Research-stage concern.** Branch B operates as a post-parse pass over
  already-typed mdast `text` nodes (per ADR-122), where emphasis markers
  (`**`, `_`) are ordinarily consumed into `strong`/`emphasis` node
  structure rather than appearing as literal characters in a text node's
  value — unlike the resolver's regex, which runs over raw, pre-parse line
  text. Achieving identical accept/reject behavior may therefore require a
  different underlying mechanism than a literal regex port; this spec
  states the required behavior (FR-1/FR-2), not the mechanism.
- **A shared fixture list across this repo and `verveguy/liminis` is out of
  scope for this issue.** The originating issue text "strongly considers"
  one, noting that two hand-maintained rules in two repos happening to
  agree is exactly what produced #124's defect. It is a good idea but
  requires cross-repo coordination and infrastructure decisions beyond this
  issue's settled scope; tracked below as a candidate follow-up rather than
  a requirement here.

## Out of Scope

- Branch A (the ULID, position-unconstrained rule) — untouched (FR-5).
- Mid-line anchors, wrapped or not — that is #126's territory.
- Wrapper forms other than `**`, `__`, `*`, `_`: triple emphasis (`***…***`),
  strikethrough (`~~…~~`), backtick-wrapped, and paren-wrapped forms stay
  unresolved and unbadged (see Edge Cases).
- Any change to the resolver itself (`verveguy/liminis#1114`) — that PR
  lives in the separate `verveguy/liminis` repository and is coordinated
  with, not implemented by, this issue.
- A shared cross-repo fixture list (see Assumptions) — a candidate follow-up
  issue, not a requirement here.

## Source References

- Issue #122 / `docs/decisions/adr-122-block-anchor-badge.md` (original
  ULID-only badge decision and detection architecture).
- Issue #124 (`fabrik/issue-124`, PR #125 — open, unmerged) — introduces
  `findBlockAnchorMatches`'s Branch A/Branch B split and the resolver
  position rule Branch B currently enforces.
- Issue #126 (`fabrik/issue-126`) — the open question (Branch A position
  constraint) this issue was split out from; not a dependency of this
  issue's requirements.
- `verveguy/liminis#1114` (separate repository) — widens
  `ANCHOR_LINE_PATTERN` to the symmetric-wrapper form this issue mirrors.
- `src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/checkbox-anchor-formatted.md`
  — the existing fixture this issue's FR-3/SC-002 are verified against.

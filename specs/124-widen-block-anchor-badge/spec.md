# Feature Specification: Widen block-anchor badge detection beyond strict ULID

**Feature Branch**: `fabrik/issue-124`
**Created**: 2026-09-09
**Status**: Specified
**Input**: User description: "Widen block-anchor badge detection beyond strict ULID (badge and resolver currently disagree)"

## Background

#122 shipped block-anchor badges detecting **only** the 26-character uppercase Crockford Base32 ULID shape. ADR-122 argues that length is the disambiguating signal, and that a broader charset could not satisfy both supporting the id forms in use and never badging ordinary prose like `x^2`, `2^10`.

That trade turns out to be based on a premise that is weaker than it looks:

**Math and code are excluded structurally, not by the charset.** They are their own node types; the text splitter never sees inside them. The evidence is in #122's own fixtures — to exercise the math case at all, it had to construct a ULID *inside* MathJax delimiters (`The value $x^{01M00VDX0S4JHMDNA7F776Y8R8}$ stays literal.`). A plain `x^2` was never a candidate. Same for inline code and fenced blocks.

**Real mathematics in this system is written in MathJax syntax** (`$x^2$`), so it lives inside math nodes by construction. What ULID-strictness actually protects against is the narrow residue: a bare caret in plain prose, written *outside* math delimiters, such as `2^10` typed casually mid-sentence.

**Why this matters:** the resolver (verveguy/liminis#1109, merged) treats a block id as an **opaque token**, matching `@liminis/editor`'s own reference-side parser (`/#\^([^\s\]#]+)$/`). So today the product is internally inconsistent:

- Write `^1867432905318744064` in a note → **no badge** (reads as "not an anchor")
- Reference it as `![[file#^1867432905318744064]]` → **resolves and transcludes fine**

The UI says it isn't an anchor while the system treats it as one. That is the actual defect to fix, and it is user-visible in `demo-notebook`, which now carries snowflake and short-id anchors alongside ULIDs.

### Resolution reached during clarification

Two approaches were weighed:

1. **A charset/length heuristic** ("not a plain number, or longer than N digits"). This runs into a genuine tension: encoded ids (ULID, NanoID, base62 snowflakes/sonyflakes, UUID) are all "not a plain number" and need no length escape hatch, but a **raw-decimal** snowflake (`^1867432905318744064`) is pure digits and would be excluded by a bare not-a-number rule, forcing a length threshold back in.
2. **Adopting the resolver's position rule verbatim**: `/(?:^|\s)\^([^\s\]#]+)\s*$/` — the caret must start a token (line start or preceded by whitespace) and the captured id must run to end of line. This needs no charset or length reasoning at all, and was verified against every form discussed on this issue (ULID, raw-decimal snowflake, NanoID with `_`/`-`, base62) as well as every prose case (`2^10` mid-line and at line end, `10^100`, `mc^2`, `a ^ b`) — it badges the anchors and excludes the prose in every case tried.

A third option — an unambiguous sigil (`^=`) instead of a heuristic — was considered and rejected. Obsidian interoperability is not a hard requirement for this project, but the `^` sigil preserves it at no cost, and switching sigils would require migrating existing anchors and changing how `liminis-framework`'s actions tooling writes them. Keeping `^` and adopting the position rule gets the same encoding-agnostic simplicity without that cost.

**Decision: keep the `^` sigil, and adopt the resolver's position rule in the badge detector**, so badge and resolver agree by construction rather than by coincidence. This supersedes the charset/length-heuristic approach and ADR-122's "length is the disambiguating signal" rationale.

**Minimum-length threshold: considered and rejected.** A threshold (e.g. ~8 characters) was proposed to exclude the one contrived case the position rule alone doesn't resolve — a bare short number at line end preceded by whitespace, such as `^100`. It is rejected: this issue's own examples require short alphanumeric ids to badge (`^a1b2c3`, 6 characters), and any floor high enough to exclude `^100` also excludes ids of that length, reintroducing the exact false-negative this issue exists to fix. The residual false-positive risk — a bare number, preceded by whitespace, at the very end of a line, outside a MathJax block — is accepted rather than filtered: it requires an author to end a line on a lone number with a caret in front of it and nothing after, which is not how exponents are normally written (`2^10` continues the sentence; real math is wrapped in MathJax). No length floor is applied; the position rule (FR-002) is the sole disambiguator.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Badge non-ULID anchors consistently with the resolver (Priority: P1)

As an editor user, when I write a block anchor using an id form the resolver understands (ULID, raw-decimal snowflake, NanoID, base62, short alphanumeric, etc.), I want it rendered as a badge, so the UI accurately reflects what the resolver will treat as an anchor.

**Why this priority**: This is the core defect the issue exists to fix — badge/resolver disagreement is user-visible today in `demo-notebook`.

**Independent Test**: Open a notebook containing a snowflake-style anchor (`^1867432905318744064`) and a short alphanumeric anchor (`^a1b2c3`); confirm both render as badges, matching what `![[file#^...]]` resolves elsewhere.

**Acceptance Scenarios**:

1. **Given** a line ending in `^1867432905318744064` (a raw-decimal snowflake-style id), **When** the editor renders it, **Then** it displays as a block-anchor badge.
2. **Given** a line ending in `^a1b2c3` (a short alphanumeric id), **When** the editor renders it, **Then** it displays as a block-anchor badge.
3. **Given** a line ending in `^01KKE2V4H0B2DRJ6CEER5S4E6F` (ULID), **When** the editor renders it, **Then** it continues to display as a badge (no regression).

---

### User Story 2 - Ordinary prose with carets is never mistaken for an anchor (Priority: P1)

As an editor user writing normal prose or inline math outside MathJax delimiters, I want carets used for exponents or unrelated punctuation to never be badged as block anchors, so my writing isn't cluttered with false badges.

**Why this priority**: Equally critical — false positives erode trust in the badge feature directly, and this is the constraint the original ULID-only rule existed to protect.

**Independent Test**: Type `2^10`, `x^2`, `mc^2`, `10^100`, and `a ^ b` in prose, both mid-line and at line end; confirm none render as badges.

**Acceptance Scenarios**:

1. **Given** the text "The value is 2^10" (mid-sentence or at line end), **When** rendered, **Then** no badge appears.
2. **Given** the text "A googol is 10^100" at line end, **When** rendered, **Then** no badge appears.
3. **Given** the text "Einstein wrote mc^2", **When** rendered, **Then** no badge appears (in-word caret).
4. **Given** the text "Compare a ^ b here", **When** rendered, **Then** no badge appears (spaced caret).

---

### Edge Cases

- A short, all-digit caret token at line end preceded by whitespace, such as `^100` — genuinely ambiguous between "a short numeric id" and "a small exponent typed as a trailing note." Resolved: this is an accepted, rare false positive rather than a gap to close — see Background for why a length threshold was rejected.
- Math and code contexts are confirmed structurally excluded already (they are separate node types, never reached by the text splitter); no new handling is required, but a regression test should confirm this remains true.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Badge detection MUST accept the id forms the resolver accepts, including at minimum: ULIDs, raw-decimal snowflake-style numeric ids, NanoID-style ids (containing `_` and `-`), mixed-case base62 ids, and UUID-style ids (containing hyphens).
- **FR-002**: Badge detection MUST use a position rule equivalent to the resolver's `/(?:^|\s)\^([^\s\]#]+)\s*$/` — the caret must start a token (line start or preceded by whitespace) and the captured id must run to the end of the line — rather than inferring anchor-hood from charset or a "looks like a number" test.
- **FR-003**: Ordinary prose containing a caret (`2^10`, `x^2`, `mc^2`, `a ^ b`, `10^100`) MUST NOT be badged, whether the caret appears mid-line or the numeric run appears at line end.
- **FR-004**: Round-trip MUST remain byte-identical; #122's `roundtrip/122-block-anchor/` fixtures continue to pass unchanged.
- **FR-005**: Math and code contexts MUST remain unbadged. This is already true structurally (separate node types); this requirement is a regression check, not new behavior.
- **FR-006**: The block-anchor sigil remains `^` (no change to `^=` or any other marker). No migration of existing anchors is required, and no change to `liminis-framework`'s anchor-writing tooling is in scope.
- **FR-007**: ADR-122 MUST be updated — by amendment, not rewrite, per this repository's ADR conventions — to record that the position rule, not charset or length, is the disambiguating signal, and why: math/code are excluded structurally by node type, position handles prose carets, and a minimum-length threshold was considered and rejected because it conflicts with badging short alphanumeric ids (see Background).

### Key Entities *(if applicable)*

Not applicable — no new data entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A raw-decimal snowflake-style anchor and a short alphanumeric anchor both render as badges.
- **SC-002**: `2^10`, `x^2`, `mc^2`, `10^100`, and `a ^ b` in prose remain unbadged, evidenced by fixtures.
- **SC-003**: Everything badged by the current ULID rule is still badged — no regression.
- **SC-004**: `demo-notebook`'s anchors (ULID, snowflake, short id) all badge consistently with what the resolver resolves.
- **SC-005**: Badge detection and the resolver's position rule are verified to behave identically on the same set of test inputs, so the two components agree by construction rather than coincidence.

## Assumptions

- Obsidian interoperability is not a hard requirement for this project, but keeping the `^` sigil preserves it at no cost, so the sigil is retained rather than switched to an explicit marker like `^=`.
- The resolver's regex operates line-wise over file text, while the badge detector operates over inline text runs in the editor. This spec assumes an equivalent position rule can be implemented against the editor's text-run model; confirming the `\s*$` (end-of-line) semantics translate correctly to inline runs is a research-stage concern, not a spec-level one.
- The position rule alone resolves the false-positive risk without any charset restriction, so no enumeration of "known" id formats is needed — the detector stays encoding-agnostic, and a future switch from ULID to another id scheme needs no change here.
- No minimum-length threshold is applied on top of the position rule (see Background) — the residual false positive on a bare trailing number like `^100` is accepted as rarer and less costly than excluding legitimate short alphanumeric ids.

## Out of Scope *(optional)*

- Changing the resolver (verveguy/liminis#1109 is merged and correct).
- Any change to the reference-side parser.
- Introducing a new sigil (e.g., `^=`) for block anchors — considered and rejected in favor of keeping `^`.
- Migrating existing `^`-prefixed anchors, or changing how `liminis-framework`'s actions tooling writes anchors.

## Source References *(optional)*

- verveguy/liminis#1109 (resolver, merged) — `liminis-app/src/main/fs.ts`, regex `/(?:^|\s)\^([^\s\]#]+)\s*$/`
- ADR-122 (block-anchor badge detection; current ULID-only rationale — to be amended)
- `@liminis/editor` reference-side parser: `/#\^([^\s\]#]+)$/`
- #122 roundtrip fixtures: `roundtrip/122-block-anchor/`

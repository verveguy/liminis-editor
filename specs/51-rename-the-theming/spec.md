# Feature Specification: Rename the Theming Vocabulary Off the `--vscode-*` Prefix

**Feature Branch**: `fabrik/issue-51`
**Created**: 2026-08-18
**Status**: Draft
**Input**: User description: "Rename the theming vocabulary from `--vscode-*` to a package-owned prefix, as a breaking change in `0.2.0`."

## Background

The theming vocabulary `src/` consumes is not a single, coherent set of names — it is a patchwork of four origin-tracking prefixes, none of which is the package's own. Measured on current `main`, of the 59 CSS custom properties consumed (per the generated inventory from #50, `scripts/lib/theming-tokens.mjs`):

| prefix | count |
|---|---|
| `--slashmd-*` | 30 |
| `--vscode-*` | 24 |
| `--color-*` | 4 |
| `--checkbox-*` | 1 |
| **total** | **59** |

`--vscode-*` records that this code came from a VS Code extension; `--slashmd-*` — the largest group — records the name of the upstream project this editor was derived from. Neither reflects where the code is going, and `--slashmd-*` arguably reads as more misleading than `--vscode-*`: it implies a relationship to a project named "slashmd" that means nothing to an adopter and does not exist for them, whereas `--vscode-*` is at least a recognisable theming convention. The defect this issue addresses is the inconsistency itself — four unrelated naming vocabularies for one theming surface — not any single prefix in isolation.

Decision taken: rename in a breaking release rather than hedge the names in documentation now. Documenting the current names (#50) was deliberately not an endorsement of them.

This rename shares its release with #49 (drop the Tailwind requirement). `package.json` on `main` is already at `0.2.0`, bumped by #49, and that version is unreleased — it exists on `main` but has never been published to npm. This is deliberate: #49 and this issue are both breaking changes to the same package, held so that one release carries both rather than making liminis-app and Zusammen absorb two consecutive breaking upgrades.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public package adopter sees a vocabulary that reflects the package, not an unrelated editor or upstream project (Priority: P1)

An engineer installs `@liminis/editor` and reads the token reference to theme it. Today the properties in the vocabulary this issue covers are split across four inconsistent prefixes (`--slashmd-*`, `--vscode-*`, `--color-*`, `--checkbox-*`), naming an editor and an upstream project the adopter may never have heard of. With this change, the in-scope properties carry a package-owned prefix (`--liminis-editor-*`, unless a better one emerges during the work) instead.

**Why this priority**: This is the core problem statement in the issue.

**Independent Test**: Read the regenerated token reference in `README.md` and confirm no in-scope property (per the resolution of the open scope question below) still carries one of the old prefixes.

**Acceptance Scenarios**:

1. **Given** the rename is complete, **When** a reader opens the generated token table in `README.md`, **Then** every in-scope property name carries the package-owned prefix, not `--vscode-*`, `--slashmd-*`, `--color-*`, or `--checkbox-*`.
2. **Given** the rename is complete, **When** the drift guard (`tests/theming-contract.test.ts`) runs, **Then** it passes against the renamed property names with no manual edits required to keep it green.

---

### User Story 2 - Existing hosts are not silently and invisibly broken (Priority: P1)

liminis-app and Zusammen currently supply `--vscode-*` custom properties to theme the editor. Unresolved custom properties fall back rather than error, so if the rename ships as a clean break, any host still supplying only the old names loses its theme with no error, warning, or visual cue pointing at the cause. With this change, the chosen compatibility story determines whether that host keeps working during a migration window, and the risk of silent breakage is called out prominently wherever the change is announced.

**Why this priority**: Called out explicitly in the issue as the substance of the decision this issue must make, not a mechanical rename.

**Independent Test**: Configure a host to supply only pre-rename `--vscode-*` custom properties, install the post-rename package, and confirm the resulting behavior (theme resolves via fallback, or breaks) matches whichever compatibility story was chosen and documented.

**Acceptance Scenarios**:

1. **Given** a recommendation and reasoning for one of clean break / fallback layer / dual-accepted-with-deprecation, **When** the rename ships, **Then** the chosen story is implemented consistently across all in-scope properties, not applied to some and not others.
2. **Given** the chosen compatibility story allows old names to keep working, **When** a host supplies only old-prefix names post-upgrade, **Then** its theme continues to resolve as it did before the rename.
3. **Given** any host supplying only old-prefix names post-upgrade under a clean-break story, **When** the release notes for `0.2.0` are read, **Then** the silent loss of theming is called out prominently, not buried.

---

### User Story 3 - The in-house consumers keep working (Priority: P2)

liminis-app and Zusammen are the two hosts currently supplying `--vscode-*` tokens to this package. With this change, both are updated to supply the package-owned names so their themes are not left depending on a compatibility fallback indefinitely.

**Why this priority**: Explicitly scoped in the issue; these are the only two hosts the issue's authors can directly verify and fix themselves.

**Independent Test**: After the rename ships and liminis-app and Zusammen are updated, load each and confirm the editor renders with the intended theme, not the package's built-in defaults.

**Acceptance Scenarios**:

1. **Given** the rename and the updates to liminis-app and Zusammen are complete, **When** either application is run, **Then** the editor displays that application's intended theme, not a fallback default.

---

### Edge Cases

- A host supplying a mix of old and new names across different properties (a partial migration) under a fallback-layer or dual-accepted compatibility story.
- An in-scope property that has neither a `styles.css` default nor an inline fallback would silently drop rather than error if the rename introduced a naming mismatch between the two; #50 found no such gap exists today, and this rename must not introduce one.
- The generated README token table and the drift guard must be regenerated as part of this change, not hand-edited, so they cannot drift again immediately after the rename lands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The properties resolved as in-scope (see Open Questions) MUST be renamed to a package-owned prefix (`--liminis-editor-*`, unless a better one emerges during the work).
- **FR-002**: The rename MUST use the token inventory generated by `scripts/lib/theming-tokens.mjs` (#50) as the worklist, so completeness is provable rather than a best-effort search-and-replace.
- **FR-003**: A compatibility story MUST be chosen from clean break, fallback layer, or both-accepted-with-old-ones-deprecated-and-removed-in-`0.3.0`, applied consistently to every in-scope property, and documented with reasoning — a recommendation is required, not an arbitrary pick.
- **FR-004**: The generated token reference in `README.md` (from #50) MUST be regenerated to reflect the renamed properties, so it cannot go stale relative to the rename.
- **FR-005**: The drift guard (`tests/theming-contract.test.ts`, from #50) MUST continue to pass against the renamed property names.
- **FR-006**: The two in-house consumers, liminis-app and Zusammen, MUST be updated to supply the package-owned token names.
- **FR-007**: Wherever the chosen compatibility story permits a host to still lose its theme silently (i.e., any option short of a permanent fallback), that risk MUST be called out prominently in the `0.2.0` release notes.
- **FR-008**: This work MUST NOT bump the version in `package.json` — it is already `0.2.0`, set by #49, and is held unreleased so one release carries both breaking changes.
- **FR-009**: The release note for this change MUST be written as part of the shared `0.2.0` release notes, alongside #49's, not as a standalone version entry.
- **FR-010**: This work MUST NOT cut a release, publish to npm, or create a release tag — the release is cut by hand once both #49 and this issue are merged.

### Key Entities

- **Custom Property Token**: a CSS custom property consumed somewhere in `src/` via `var()`, per the #50 inventory. Attributes: current name, target name (if in scope for rename), and which of the four current naming families it belongs to (`--vscode-*`, `--slashmd-*`, `--color-*`, `--checkbox-*`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero in-scope properties (per the resolved Open Question) remain consumed under their old prefix in `src/` after the rename.
- **SC-002**: The `README.md` generated token table and the drift guard (`tests/theming-contract.test.ts`) both reflect the renamed properties with zero drift between documented and consumed names.
- **SC-003**: liminis-app and Zusammen render their intended themes, not package defaults, when run against the renamed package.
- **SC-004**: A written, reasoned recommendation for the compatibility story exists and is implemented consistently across every in-scope property.
- **SC-005**: `package.json`'s version is unchanged by this work (`0.2.0`), and no release, publish, or tag is created as part of it.

## Assumptions

- The consumed-token count is 59: 30 `--slashmd-*`, 24 `--vscode-*`, 4 `--color-*`, and 1 `--checkbox-*`, per direct extraction with `scripts/lib/theming-tokens.mjs` on current `main`. The originally-cited count of 60 included `--vscode-text`, a typo since removed by #52.
- `--liminis-editor-*` is the working assumption for the package-owned prefix; the issue itself allows a better name to emerge during the work, and this spec does not pin it further.
- The specific implementation mechanism for the compatibility story (e.g., exact fallback nesting, deprecation warning delivery) is a technical decision for the Research/Plan stage; this spec constrains only its observable behavior (FR-003, FR-007) and the requirement that it be chosen deliberately and justified.
- "Update the two in-house consumers" means updating liminis-app and Zusammen to supply the new token names where they currently supply old-prefix names; it does not imply any other change to those applications.

## Out of Scope

- Bumping `package.json`'s version — it is already `0.2.0`, set by #49, and this work does not change it.
- Cutting or publishing the `0.2.0` release, or creating its release tag — done by hand once #49 and this issue are both merged.
- Any change to #49's scope (dropping the Tailwind requirement).
- Adding new custom properties, new `styles.css` defaults, or documentation not already implied by the rename (that groundwork was #50's).

## Source References

- Issue #49 — the sibling breaking change sharing the `0.2.0` release; this issue must not duplicate its version bump or cut its own release.
- Issue #50 — generated token inventory (`scripts/lib/theming-tokens.mjs`) and drift guard (`tests/theming-contract.test.ts`) this rename depends on, must use as its worklist, and must keep passing.
- Issue #52 — removed the `--vscode-text` typo, correcting the consumed-token count from 60 to 59.
- `README.md` — the generated theming reference (between the `<!-- theming-tokens:start/end -->` markers) that moves with the rename.

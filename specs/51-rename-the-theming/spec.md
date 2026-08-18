# Feature Specification: Rename the Theming Vocabulary Off the `--vscode-*` Prefix

**Feature Branch**: `fabrik/issue-51`
**Created**: 2026-08-18
**Status**: Specified
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

`--vscode-*` records that this code came from a VS Code extension; `--slashmd-*` — the largest group — records the name of the upstream project this editor was derived from. Neither reflects where the code is going, and `--slashmd-*` arguably reads as more misleading than `--vscode-*`: it implies a relationship to a project named "slashmd" that means nothing to an adopter and does not exist for them, whereas `--vscode-*` is at least a recognisable theming convention. The defect this issue addresses is the inconsistency itself — four unrelated naming vocabularies for one theming surface — not any single prefix in isolation. Renaming only one of the four vocabularies would leave the other three, which is strictly less coherent than doing all of them or none; since this is already a breaking change and each consumer migration has a measured cost, splitting it into a second pass later means paying that cost twice.

Decision taken: rename in a breaking release rather than hedge the names in documentation now. Documenting the current names (#50) was deliberately not an endorsement of them.

This rename shares its release with #49 (drop the Tailwind requirement). `package.json` on `main` is already at `0.2.0`, bumped by #49, and that version is unreleased — it exists on `main` but has never been published to npm. This is deliberate: #49 and this issue are both breaking changes to the same package, held so that one release carries both rather than making liminis-app and Zusammen absorb two consecutive breaking upgrades.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public package adopter sees a vocabulary that reflects the package, not an unrelated editor or upstream project (Priority: P1)

An engineer installs `@liminis/editor` and reads the token reference to theme it. Today the properties in the vocabulary this issue covers are split across four inconsistent prefixes (`--slashmd-*`, `--vscode-*`, `--color-*`, `--checkbox-*`), naming an editor and an upstream project the adopter may never have heard of. With this change, all 59 consumed properties carry a single package-owned prefix, `--liminis-editor-*`.

**Why this priority**: This is the core problem statement in the issue.

**Independent Test**: Read the regenerated token reference in `README.md` and confirm every one of the 59 properties is documented under `--liminis-editor-*` as its primary name; none still carries `--slashmd-*`, `--vscode-*`, `--color-*`, or `--checkbox-*` as its primary name.

**Acceptance Scenarios**:

1. **Given** the rename is complete, **When** a reader opens the generated token table in `README.md`, **Then** every one of the 59 properties is listed under the `--liminis-editor-*` prefix as its primary name.
2. **Given** the rename is complete, **When** the drift guard (`tests/theming-contract.test.ts`) runs, **Then** it passes against the renamed property names with no manual edits required to keep it green.

---

### User Story 2 - Existing hosts are not silently and invisibly broken (Priority: P1)

liminis-app and Zusammen currently supply `--vscode-*` custom properties to theme the editor. Unresolved custom properties fall back rather than error, so a clean-break rename would strip theming from any host still supplying only old names, with no error, warning, or visual cue pointing at the cause. With this change, a fallback layer keeps every host that supplies only old names theming exactly as before, and the eventual removal of those old names is called out in the `0.2.0` release notes so adopters know to migrate ahead of it.

**Why this priority**: Called out explicitly in the issue as the substance of the decision this issue must make, not a mechanical rename.

**Independent Test**: Configure a host to supply only pre-rename names (e.g. `--vscode-*` or `--slashmd-*`), install the post-rename package, and confirm its theme continues to resolve unchanged via the fallback layer to those pre-rename names.

**Acceptance Scenarios**:

1. **Given** the fallback-layer compatibility story (FR-003), **When** the rename ships, **Then** it is implemented consistently across all 59 properties, not applied to some and not others.
2. **Given** the fallback layer keeps old names working, **When** a host supplies only old-prefix names post-upgrade, **Then** its theme continues to resolve exactly as it did before the rename.
3. **Given** the old names remain supported via fallback but are deprecated, **When** the release notes for `0.2.0` are read, **Then** the deprecation and future removal are documented prominently, so hosts relying on old names know to migrate before a later major release removes them.

---

### User Story 3 - The in-house consumers keep working (Priority: P2)

liminis-app and Zusammen are the two hosts currently supplying `--vscode-*` tokens to this package. With this change, both are updated to supply the package-owned names so their themes are not left depending on a compatibility fallback indefinitely.

**Why this priority**: Explicitly scoped in the issue; these are the only two hosts the issue's authors can directly verify and fix themselves.

**Independent Test**: After the rename ships and liminis-app and Zusammen are updated, load each and confirm the editor renders with the intended theme, not the package's built-in defaults.

**Acceptance Scenarios**:

1. **Given** the rename and the updates to liminis-app and Zusammen are complete, **When** either application is run, **Then** the editor displays that application's intended theme, not a fallback default.

---

### Edge Cases

- A host supplying a mix of old and new names across different properties (a partial migration) under the chosen fallback-layer compatibility story.
- A renamed property that has neither a `styles.css` default nor an inline fallback would silently drop rather than error if the rename introduced a naming mismatch between the two; #50 found no such gap exists today, and this rename must not introduce one.
- The generated README token table and the drift guard must be regenerated as part of this change, not hand-edited, so they cannot drift again immediately after the rename lands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All 59 properties consumed in `src/` (per the #50 inventory: `--slashmd-*` 30, `--vscode-*` 24, `--color-*` 4, `--checkbox-*` 1) MUST be renamed to a single package-owned prefix, `--liminis-editor-*` — not split into an org-wide `--liminis-*` tier for generic tokens plus a narrower `--liminis-editor-*` tier for editor-specific ones.
- **FR-002**: The rename MUST use the token inventory generated by `scripts/lib/theming-tokens.mjs` (#50) as the worklist, so completeness is provable rather than a best-effort search-and-replace, and MUST cover all 59 properties, not a subset.
- **FR-003**: A fallback-layer compatibility story MUST be implemented consistently across every one of the 59 properties: each renamed property MUST resolve through a fallback chain — the new `--liminis-editor-*` name first, then that property's specific previous name (`--slashmd-*`, `--vscode-*`, `--color-*`, or `--checkbox-*`, whichever it actually was), then the property's existing default — so a host supplying only the old name continues to theme exactly as it did before the rename.
- **FR-004**: The generated token reference in `README.md` (from #50) MUST be regenerated to reflect the renamed properties, so it cannot go stale relative to the rename.
- **FR-005**: The drift guard (`tests/theming-contract.test.ts`, from #50) MUST continue to pass against the renamed property names.
- **FR-006**: The two in-house consumers, liminis-app and Zusammen, MUST be updated to supply the package-owned token names.
- **FR-007**: The `0.2.0` release notes MUST document that the old property names are deprecated and will be removed in a future major release, so hosts relying on the fallback know to migrate ahead of that removal, even though the fallback itself means no host loses theming at this release.
- **FR-008**: This work MUST NOT bump the version in `package.json` — it is already `0.2.0`, set by #49, and is held unreleased so one release carries both breaking changes.
- **FR-009**: The release note for this change MUST be written as part of the shared `0.2.0` release notes, alongside #49's, not as a standalone version entry.
- **FR-010**: This work MUST NOT cut a release, publish to npm, or create a release tag — the release is cut by hand once both #49 and this issue are merged.
- **FR-011**: The drift guard (`tests/theming-contract.test.ts`) MUST be extended to fail if any renamed property is introduced without a preserved fallback to its previous name, so a partial rename (a new name added without its fallback) cannot merge undetected.

### Key Entities

- **Custom Property Token**: a CSS custom property consumed somewhere in `src/` via `var()`, per the #50 inventory. Attributes: previous (now deprecated) name, new `--liminis-editor-*` name, which of the four previous naming families it belonged to (`--vscode-*`, `--slashmd-*`, `--color-*`, `--checkbox-*`), and its fallback chain (new name → previous name → existing default).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 59 properties are consumed in `src/` under the `--liminis-editor-*` prefix as the primary name; a previous-family name (`--slashmd-*`, `--vscode-*`, `--color-*`, `--checkbox-*`) appears only as a fallback within that chain, never as the primary consumed name.
- **SC-002**: The `README.md` generated token table and the drift guard (`tests/theming-contract.test.ts`) both reflect the renamed properties with zero drift between documented and consumed names.
- **SC-003**: liminis-app and Zusammen render their intended themes, not package defaults, when run against the renamed package.
- **SC-004**: The fallback-layer compatibility story is implemented consistently across every one of the 59 properties — none renamed without a working fallback to its previous name.
- **SC-005**: `package.json`'s version is unchanged by this work (`0.2.0`), and no release, publish, or tag is created as part of it.
- **SC-006**: The drift guard fails CI if any renamed property is introduced without a preserved fallback to its previous name.

## Assumptions

- The consumed-token count is 59: 30 `--slashmd-*`, 24 `--vscode-*`, 4 `--color-*`, and 1 `--checkbox-*`, per direct extraction with `scripts/lib/theming-tokens.mjs` on current `main`. The originally-cited count of 60 included `--vscode-text`, a typo since removed by #52.
- The prefix is confirmed as `--liminis-editor-*`, applied as a single tier to all 59 properties. An org-wide `--liminis-*` tier for the ~42 properties that are generic design tokens (`foreground`, `border`, `link`, `font-family`, `token-keyword`, etc.), split from an editor-specific `--liminis-editor-*` tier for the rest, was considered and rejected: not every consumer of this package is a Liminis product (Zusammen and external adopters are not), so a non-Liminis host would otherwise be forced to declare Liminis-branded globals for a component it merely depends on. If an org-wide `--liminis-*` vocabulary emerges later, Liminis apps can map individual tokens (e.g. `--liminis-editor-foreground: var(--liminis-foreground);`) without requiring non-Liminis adopters to do anything; retracting org-wide globals once adopters depend on them is not similarly available.
- "Update the two in-house consumers" means updating liminis-app and Zusammen to supply the new `--liminis-editor-*` token names where they currently supply old-prefix names; it does not imply any other change to those applications.

## Out of Scope

- Bumping `package.json`'s version — it is already `0.2.0`, set by #49, and this work does not change it.
- Cutting or publishing the `0.2.0` release, or creating its release tag — done by hand once #49 and this issue are both merged.
- Any change to #49's scope (dropping the Tailwind requirement).
- Adding new custom properties, new `styles.css` defaults, or documentation not already implied by the rename (that groundwork was #50's).
- Removing the deprecated old names — they stay supported via the fallback layer through this release and are removed only in a later major release, outside this issue's scope.

## Source References

- Issue #49 — the sibling breaking change sharing the `0.2.0` release; this issue must not duplicate its version bump or cut its own release.
- Issue #50 — generated token inventory (`scripts/lib/theming-tokens.mjs`) and drift guard (`tests/theming-contract.test.ts`) this rename depends on, must use as its worklist, and must keep passing (extended per FR-011).
- Issue #52 — removed the `--vscode-text` typo, correcting the consumed-token count from 60 to 59.
- `README.md` — the generated theming reference (between the `<!-- theming-tokens:start/end -->` markers) that moves with the rename.

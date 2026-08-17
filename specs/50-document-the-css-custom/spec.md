# Feature Specification: Document the CSS Custom-Property Theming Contract

**Feature Branch**: `fabrik/issue-50`
**Created**: 2026-08-17
**Status**: Specified
**Input**: User description: "Document the editor's CSS custom-property theming contract, using the token names as they exist today. Nothing is renamed here and no default is added — this issue makes the existing contract discoverable, and that is all."

## Background

The package has a real theming system — CSS custom properties consumed throughout `src/` — but it is completely undiscoverable from outside the repository:

| | |
|---|---|
| distinct custom properties consumed by `src/` | **60** |
| defaults defined in `styles.css` `:root` | **21** |
| documented in `README.md` or `docs/` | **0** |

The most-used: `--vscode-foreground` (53 references), `--vscode-border` (41), `--vscode-link` (28), `--vscode-code-bg` (28).

An adopter installs the package, imports `styles.css` as instructed, supplies nothing, and hits roughly 39 unresolved properties. Unresolved custom properties do not error — they fall back to inherited or initial values — so the editor renders, looks wrong in ways that are hard to attribute, and offers no way to discover what to set.

The editor is thoroughly themeable and nobody outside this repository can tell. Both of the obvious next improvements — shipping more defaults, and renaming the `--vscode-*` vocabulary (tracked separately in #51) — are improvements to a contract nobody can currently read. Writing the contract down is the cheapest step, unblocks adopters immediately, and produces the inventory that #51 will need in order to be complete rather than approximate.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adopter discovers and uses the full token vocabulary (Priority: P1)

An engineer installs `@liminis/editor`, imports `styles.css`, and wants to restyle the editor to match their host application's design system. Today there is nothing to read — no list of what properties exist or what they affect. With this change, they open `README.md` and find every custom property the editor consumes, a description of what each one controls, and whether it is structural or cosmetic.

**Why this priority**: This is the core problem statement in the issue — a real, working theming system that no adopter can discover or use.

**Independent Test**: Give a reader who has never opened `styles.css` or `src/` a copy of `README.md` and ask them to restyle five arbitrary aspects of the editor (e.g., link color, code background, a heading color). They should be able to identify the correct property names and produce a working override using README.md alone.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the repository, **When** a reader opens `README.md`, **Then** they find a complete reference listing every custom property consumed under `src/`, each with a description of what it controls.
2. **Given** the token reference in `README.md`, **When** a reader wants to theme the editor, **Then** they can do so by reading `README.md` alone, without opening `styles.css` or any file under `src/`.
3. **Given** the worked example in `README.md`, **When** a reader follows it to override a handful of tokens, **Then** the described visual effect matches what those tokens actually control in `src/`.

---

### User Story 2 - Documentation drift is caught automatically (Priority: P1)

A future contributor adds a new `var(--something)` in `src/`, or removes the last usage of an existing one, without updating the README reference. Today nothing catches this — an inventory produced once starts rotting the moment the next PR merges. With this change, an automated test compares the set of properties actually consumed in `src/` against the set documented in `README.md` and fails when they differ in either direction.

**Why this priority**: Called out explicitly in the issue as the difference between a one-time snapshot and a maintained contract; without it, Story 1's inventory has a shelf life of one release.

**Independent Test**: Add a `var(--deliberately-undocumented-token)` reference to a source file without updating the README reference, run the test suite, and confirm the new test fails and identifies the offending property. Revert the change and confirm the test passes again.

**Acceptance Scenarios**:

1. **Given** the current codebase, **When** the drift-guard test runs, **Then** it passes because every consumed property is documented and every documented property is consumed.
2. **Given** a source file with a newly added `var(--x)` that has no corresponding entry in the README reference, **When** the drift-guard test runs, **Then** it fails and identifies the undocumented property.
3. **Given** a README reference entry for a property no longer referenced anywhere in `src/`, **When** the drift-guard test runs, **Then** it fails and identifies the stale entry.

---

### Edge Cases

- A custom property name that appears only in a comment or a non-code string, not inside an actual `var(...)` usage, must not be counted as "consumed."
- A property defined as a default in `styles.css` `:root` but never referenced via `var()` anywhere in `src/` is not part of the "consumed" set and is out of scope for the drift guard (the guard concerns consumed-vs-documented, not defaults-vs-consumed).
- Custom properties are consumed across several naming families, not only `--vscode-*` — see Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reference MUST enumerate every distinct CSS custom property referenced via `var(--...)` anywhere under `src/`, regardless of naming prefix (including but not limited to `--vscode-*`, `--slashmd-*`, `--color-*`, `--checkbox-*`).
- **FR-002**: The reference MUST be generated from source — extracted from `src/` — not hand-maintained, so it cannot silently drift from the code it describes.
- **FR-003**: For each documented property, the reference MUST state what it controls in a short, human-readable description.
- **FR-004**: The reference MUST classify each documented property as either structural or cosmetic.
- **FR-005**: The reference MUST live in `README.md`, per the issue's explicit instruction — not solely in `docs/` or elsewhere.
- **FR-006**: `README.md` MUST include a short worked example that overrides a handful of tokens and describes the resulting effect.
- **FR-007**: An automated test MUST assert that the set of properties documented in the reference is exactly equal — no fewer, no more — to the set of properties consumed in `src/`, failing on any difference in either direction.
- **FR-008**: The drift guard's failure behavior MUST be demonstrated as part of this change (e.g., via a deliberate, temporary mutation reverted before merge, or an included regression test that exercises the failure path) — not merely asserted to work.
- **FR-009**: This change MUST NOT rename any existing custom property name.
- **FR-010**: This change MUST NOT add any new default value to `styles.css` `:root`.
- **FR-011**: The reference MAY include a single forward-looking note that the `--vscode-*` prefix is planned for rename in a future breaking release (#51), but MUST NOT otherwise hedge the current names or pre-announce that rename elsewhere in the reference.

### Key Entities

- **Custom Property Token**: a CSS custom property consumed somewhere in `src/` via `var()`. Attributes: name (e.g., `--vscode-foreground`), description of what it controls, structural-or-cosmetic classification, and whether a default exists in `styles.css` `:root`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The published token reference lists every property actually consumed in `src/` at merge time (currently 60), with zero omissions.
- **SC-002**: A reader can theme the editor to a different visual style using only `README.md`, without opening `styles.css` or any file under `src/`.
- **SC-003**: The drift guard fails when a property is consumed but undocumented, and fails when a property is documented but no longer consumed — both demonstrated, not merely described, before this change merges.
- **SC-004**: Zero custom-property renames and zero new `styles.css` defaults are introduced by this change.

## Assumptions

- "Distinct custom properties consumed by `src/`" spans every naming family present in the source, not only `--vscode-*`. Direct inspection of `src/` confirms only 25 of the 60 consumed properties carry the `--vscode-*` prefix; the remainder are `--slashmd-*` (syntax-highlighting tokens, heading colors/indents, callout colors), `--color-*`, and `--checkbox-*`. The issue's acceptance criteria pin the total at 60, which is only reachable by documenting all families — this spec adopts that reading. The issue's out-of-scope note about the `--vscode-*` rename (#51) applies specifically to that one family; it does not imply the other families are excluded from this issue's documentation scope.
- "Structural versus cosmetic" is a coarse, per-property classification; the issue does not define the boundary precisely. This spec requires every property to receive one of the two labels and leaves the specific line-drawing to the Plan/Implement stages.
- The drift guard's implementation mechanism (parsing approach, test framework, exact location) is a technical decision for the Research/Plan stage; this spec constrains only its observable behavior (FR-007, FR-008).
- The existing `docs/` directory (`annotations.md`, `editor-api.md`, etc.) is not a substitute location for the token reference — the issue requires it in `README.md`.

## Out of Scope

- Renaming any `--vscode-*` (or other family's) custom property name — the `--vscode-*` rename is tracked separately in #51.
- Adding the roughly 39 currently-missing defaults for unset custom properties to `styles.css`.
- Any demo or site theme-switcher UI control.
- Introducing new custom properties not already consumed by `src/`.

## Source References

- `src/styles.css` — existing `:root` defaults and the full set of naming families in use.
- `README.md` — target location for the new theming reference and worked example.
- Issue #51 — deferred rename of the `--vscode-*` prefix, which this issue's inventory will feed.

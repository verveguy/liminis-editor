# Feature Specification: The Package's Token Definitions Are Public API

**Feature Branch**: `fabrik/issue-79`
**Created**: 2026-08-19
**Status**: Specified
**Input**: User description: "This package's `dist/styles.css` defines 42 CSS custom properties, 21 of them `--vscode-*`. Hosts read them. That makes the definitions part of the public surface, and nothing says so. The README documents the tokens as things a host may *override*. It does not say that a host may also *consume* them — and at least one does."

## Background

`tests/theming-contract.test.ts` and the README's "Theming: CSS custom
properties" section (ADR-085, ADR-087) already guard one direction of this
package's theming contract: every `--liminis-editor-*` property a host might
*set* to override the editor's palette is documented, has a resolvable
default or fallback, and preserves a fallback to its pre-0.2.0 name. That
guard protects a host that **writes** to a token.

It says nothing about a host that **reads** one. `src/styles.css` (and, via
`scripts/copy-assets.mjs`'s verbatim copy, the published `dist/styles.css`)
declares a real value for dozens of custom properties — the `--vscode-*`,
`--slashmd-*`, `--color-*` and `--checkbox-*` families that `0.2.0` (#51)
renamed at every *consumption* site but left untouched at every
*definition* site. Zusammen, a downstream host, maps its entire shadcn color
palette (`--background`, `--foreground`, `--card`, `--popover`, `--border`,
`--input`, …) onto these package-defined tokens directly:

```css
/* zusammen: app/src/renderer/index.css */
--background: var(--vscode-background);
--foreground: var(--vscode-foreground);
--card:       var(--vscode-background);
--popover:    var(--vscode-background);
--secondary:  var(--vscode-code-bg);
--border:     var(--vscode-border);
--input:      var(--vscode-border);
```

Zusammen's entire application chrome — not just the editor surface —
resolves through definitions this package owns, and nothing in the README
or the test suite says those definitions are a contract. The only reason
Zusammen survived the `0.2.0` rename is that the rename happened to leave
every existing definition's name untouched (0 removed, 0 added, comparing
the *0.1.1* and *0.2.0* published packages by diffing the declared
properties in `dist/styles.css`). That is a coincidence of what `0.2.0`
chose to do, not a guarantee that exists today: nothing would stop a future
change from renaming or removing a definition, and unresolved CSS custom
properties do not error — the declaration is simply dropped. A host that
reads a removed definition loses that value silently. No test fails,
`pnpm build` succeeds, and the failure surfaces later as "the app looks
wrong" with no trail back to a dependency bump. The near miss here was
caught by hand, during a migration, by someone who happened to check which
direction the dependency ran between this package and its host. That is not
a repeatable defence.

This issue closes that gap: state the contract where a host will read it,
and enforce it the same way the override-direction contract is already
enforced — a CI guard that fails a pull request rather than relying on
someone noticing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CI blocks a defined token being removed or renamed (Priority: P1)

A maintainer edits `styles.css` and, intentionally or not, removes the
declaration for a custom property that currently has a real value (or
renames it, which is a removal of the old name plus an addition of a new
one). CI fails on that pull request, naming the specific token(s) that
disappeared, unless the change also updates a checked-in baseline that
records the currently-defined set.

**Why this priority**: This is "Item 2" in the issue — the guard is what
makes the contract enforceable rather than aspirational. Without it, the
next rename can repeat the `0.2.0` near miss, except without the coincidence
that saved it last time.

**Independent Test**: Delete a `--name: value;` declaration from
`src/styles.css` for a property the current baseline lists, without editing
the baseline, and run the test suite. It fails, naming that property.
Restore the declaration (or update the baseline deliberately) and the suite
passes again.

**Acceptance Scenarios**:

1. **Given** the current set of defined custom properties matches the
   checked-in baseline, **When** the test suite runs, **Then** it passes.
2. **Given** a declaration for a previously-defined property is deleted from
   `styles.css` and the baseline is left unchanged, **When** the test suite
   runs, **Then** it fails, and the failure message names the specific
   removed property (not just a count mismatch).
3. **Given** a property is renamed (its old declaration deleted, a
   differently-named declaration added elsewhere) such that the *total
   count* of defined properties is unchanged, **When** the test suite runs
   without the baseline being updated, **Then** it still fails — the guard
   compares the named set, not the count, so a same-count rename cannot pass
   as if nothing happened (this is exactly the failure mode that let `0.2.0`
   through undetected: 42 defined before, 42 after, 0 removed by count).
4. **Given** a new custom property is defined (added, not renamed) without
   any other change, **When** the test suite runs, **Then** it fails only if
   the baseline is not updated to include it, in the same way #2 requires an
   explicit update — addition is not silently exempt, but the failure is
   resolved by extending the baseline rather than investigating a loss.
5. **Given** a token is defined only inside a `.dark` (or other non-`:root`)
   rule, **When** its declaration is removed, **Then** the guard flags it
   the same as a `:root`-only token — "defined" means declared with a value
   anywhere in the stylesheet, not only in `:root`.
6. **Given** a defined token that no current code under `src/` ever consumes
   via `var(--x)` (a `--vscode-*` fallback target kept alive solely for
   external hosts like Zusammen), **When** its declaration is removed,
   **Then** the guard still flags it — coverage is not limited to tokens
   `src/` itself references, since the whole point of this issue is that
   external consumption is invisible to that kind of check.

---

### User Story 2 - The README states the contract before a host relies on it (Priority: P2)

A developer integrating this package (or a maintainer reviewing a change)
reads the README's theming section and learns, without needing this issue
or its linked ADRs, that: (a) every CSS custom property this package
*defines* — not only the `--liminis-editor-*` names documented as override
points — is part of the public API; (b) a host may consume (read) these
definitions, not only override them; and (c) renaming or removing a
definition is a breaking change, distinct from renaming a consumption site
(which `0.2.0` already treats as breaking and documents in "Migrating from
the old names").

**Why this priority**: Documentation doesn't block CI on its own, but it's
what lets a future maintainer *choose* not to break the contract, rather
than the guard being the only thing standing in the way. It's listed first
in the issue's own "What to do," but the issue itself says the guard is
"the substance" — this story is P2 because it's necessary but not
sufficient.

**Independent Test**: Read the README's theming section start to finish
with no other context. Confirm it states, in terms a first-time reader
would understand, that defined tokens are consumable public API and that
removing/renaming one is a breaking change.

**Acceptance Scenarios**:

1. **Given** the README's "Theming: CSS custom properties" section (or a new
   subsection near it), **When** a reader reaches the paragraph introducing
   the token table, **Then** it states that the definitions backing these
   tokens (including the pre-0.2.0 names still declared as fallback
   targets) are themselves public API that a host may read, not only a
   surface a host may override.
2. **Given** the README's existing "Versioning policy" section (0.x, minor
   versions may break), **When** the new theming-contract text describes
   what happens if a definition is renamed or removed, **Then** it connects
   that action to the existing versioning policy rather than inventing a
   separate one.

---

### Edge Cases

- A property declared with a value in `styles.css` that is also referenced
  via `var()` somewhere in `src/` (i.e., both defined and consumed) is
  covered by both the existing consumed-token guard and the new
  defined-token guard — the two are independent and this issue does not
  merge or replace either.
- A property that appears only as a `var(--name, fallback)` reference and is
  never declared with a value anywhere in `styles.css` is *consumed* but not
  *defined*; it is out of scope for the new guard (the existing suite
  already covers consumption).
- Renaming a token *and* updating the baseline in the same pull request is
  the intended, unblocked path for a deliberate breaking change — the guard
  exists to make that intentional, not to forbid it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The README's theming documentation MUST state that the set of
  CSS custom properties this package defines (declares with a value, in any
  selector, anywhere in `styles.css`) is part of the package's public API.
- **FR-002**: The README MUST state that a host application may consume
  (read) these defined tokens, not only override them — correcting the
  current text, which frames the token table solely as an override surface
  ("so you can *override* a palette, not so you can complete one").
- **FR-003**: The README MUST state that renaming or removing a defined
  token is a breaking change, and that this is distinct from renaming a
  *consumption* site (which `0.2.0`/ADR-087 already handles via the
  fallback-chain mechanism described in "Migrating from the old names").
- **FR-004**: A new automated check MUST fail the test suite if any custom
  property present in a checked-in baseline of "currently defined tokens"
  is no longer declared with a value in `styles.css`, unless that baseline
  is explicitly updated in the same change.
- **FR-005**: The check in FR-004 MUST compare the defined set by property
  name/identity, not by count — a rename (one name removed, a different
  name added, net count unchanged) MUST still be flagged, reproducing the
  exact scenario that let `0.2.0`'s rename through unnoticed.
- **FR-006**: The check in FR-004 MUST NOT fail solely because a new token
  was added to the defined set; it fails only when a previously-baselined
  token's definition disappears without a corresponding baseline update.
- **FR-007**: The failure message for FR-004 MUST name the specific
  token(s) that disappeared, not merely report a mismatch, so a reviewer
  can immediately tell whether the change was intentional.
- **FR-008**: The defined-token set the check in FR-004 evaluates against
  MUST be representative of what a host actually receives from the
  published package — i.e., it must not be possible for a definition to be
  removed from what ships (`dist/styles.css`) while the check still passes.
- **FR-009**: Consistent with this suite's existing convention (see
  `tests/theming-contract.test.ts`'s "mutation tests" block), the new check
  MUST include a test that deliberately removes a defined token in a
  fixture and asserts the guard actually flags it — not merely asserted to
  work in the abstract.
- **FR-010**: This issue MUST NOT itself rename or remove any
  currently-defined token; the initial baseline is whatever `styles.css`
  defines at implementation time, not the historical `42`/`21` counts cited
  when this issue was filed (those numbers describe the published `0.1.1`
  and `0.2.0` packages at filing time, not necessarily the current source).
- **FR-011**: Existing assertions in `tests/theming-contract.test.ts`
  (documented-equals-consumed, resolves-without-host, per-token
  descriptions, fallback-to-previous-name) MUST continue to pass unchanged;
  this issue is additive to that suite, not a replacement for any part of
  it.

### Key Entities

- **Defined token**: A CSS custom property declared with a value
  (`--name: value;`) somewhere in `styles.css`, in any selector. This is the
  new set this issue adds a guard for. (Already computable via the
  existing `defaultedTokens()` helper in `scripts/lib/theming-tokens.mjs`,
  which every defined-but-unconsumed `--vscode-*` fallback target already
  passes through.)
- **Consumed token**: A CSS custom property referenced via `var(--name, …)`
  somewhere in `src/`. Already guarded by the existing suite; unaffected by
  this issue.
- **Documented token**: A CSS custom property listed in the README's
  generated table. Currently equals the consumed set; this issue does not
  change that equality, only adds prose stating that the defined set is
  also a contract.
- **Baseline / snapshot**: The checked-in record of which tokens are
  currently defined, that FR-004's guard compares the live `styles.css`
  against. Updating it is the explicit, reviewable act that distinguishes
  an intentional removal from an accidental one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pull request that deletes a defined token's declaration
  from `styles.css` without updating the baseline fails CI, and the failure
  output names that token.
- **SC-002**: A pull request that adds a new defined token to `styles.css`
  does not fail CI on account of this guard once the baseline is updated to
  include it (and, per FR-006, does not fail on account of the addition
  itself before that update is even made — only a disappearance triggers
  failure).
- **SC-003**: A pull request that renames a defined token (same total
  count, different name) fails CI unless the baseline is updated — this
  scenario is specifically exercised by a test, since it's the exact
  scenario `0.2.0` passed through unguarded.
- **SC-004**: A reader who reads only the README's theming section (no
  issue, no ADR, no source) can correctly answer: "May a host read
  `--vscode-background` directly instead of only overriding
  `--liminis-editor-background`?" and "Is removing `--vscode-background`'s
  definition a breaking change?"
- **SC-005**: All pre-existing assertions in `tests/theming-contract.test.ts`
  pass without modification to their intent.

## Assumptions

- "Defined" means the property is declared with a value
  (`--name: value;`) in `styles.css`, consistent with how the existing
  `defaultedTokens()` helper already computes it for the
  resolves-without-host check — this issue does not need a new definition
  of "defined," only a new guard applied to that existing notion.
- `dist/styles.css` is produced as a byte-for-byte copy of `src/styles.css`
  (`scripts/copy-assets.mjs`), with no build-time CSS transform in between.
  A guard evaluated against `src/styles.css` is therefore representative of
  what ships; FR-008 states the required outcome without mandating which
  concrete file the check reads.
- The `42` total / `21` `--vscode-*` counts in the original issue describe
  the published `0.1.1` and `0.2.0` npm packages at the time of filing, not
  necessarily the current `main` branch's `src/styles.css` (which today
  defines a different, larger set across all four legacy prefixes). The
  guard's initial baseline is derived from source at implementation time.
- Item 3 from the issue — deciding whether `--liminis-editor-*` names
  should eventually be *defined* directly, with `--vscode-*`/`--slashmd-*`/
  `--color-*`/`--checkbox-*` kept as an alias layer — is treated as a
  follow-up, not a deliverable of this issue. The issue's own text ranks it
  third and states "Item 2 is the substance"; resolving it well requires an
  ADR-weight design decision (how an alias layer interacts with the
  existing fallback chain) that is independent of stating the current
  contract and guarding it against shrinkage.

## Out of Scope

- Defining `--liminis-editor-*` tokens natively with the legacy prefixes as
  an alias layer (issue's Item 3) — tracked as a candidate follow-up issue,
  not built here.
- Any change to which tokens are currently defined, consumed, or documented
  — this issue adds documentation and a guard, it does not rename or remove
  anything.
- Changes to the existing consumed/documented equality check, the
  resolves-without-host check, or the fallback-to-previous-name check —
  all three continue exactly as they are.
- A build-time step that prunes unused definitions from `dist/styles.css`
  (tree-shaking custom properties) — not requested, and would work against
  this issue's premise that unconsumed-by-`src/` definitions are still
  public API.

## Source References

- `tests/theming-contract.test.ts` — existing contract suite this issue
  extends.
- `scripts/lib/theming-tokens.mjs` — `defaultedTokens()` already computes
  the "defined" set this issue needs a guard for.
- `scripts/copy-assets.mjs` — establishes that `dist/styles.css` is a
  verbatim copy of `src/styles.css`.
- `README.md`, "Theming: CSS custom properties" section — the documentation
  this issue updates.
- `docs/decisions/adr-085.md` — the override-direction contract and its
  drift guard (#50).
- `docs/decisions/adr-087.md` — the `--liminis-editor-*` rename and its
  fallback-chain design (#51).
- Issue #52 — the prior silent-drop incident (`--vscode-text` typo) that
  motivated the resolves-without-host check this issue's guard sits
  alongside.

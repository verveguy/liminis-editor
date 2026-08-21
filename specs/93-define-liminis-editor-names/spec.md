# Feature Specification: Define `--liminis-editor-*` Names, Without Disabling the Legacy Fallback Layer (ADR-092 Item 3)

**Feature Branch**: `fabrik/issue-93`
**Created**: 2026-08-20
**Status**: Specified
**Input**: User description: "Make `--liminis-editor-*` names defined by the package, not merely consumed — so a host can read them — without breaking the fallback layer that lets hosts still supplying legacy names keep working. This is ADR-092's deferred Item 3 from #79, and verveguy/zusammen#129 is blocked on it."

## Background

`styles.css` currently *consumes* the `--liminis-editor-*` vocabulary (224
`var()` sites in `styles.css` alone, plus 26 more across five `.tsx` files —
`SelectionContextMenuPlugin.tsx`, `DragHandlePlugin.tsx`,
`CorrectionPanelPlugin.tsx`, `C4Component.tsx`, `DiagramContextMenu.tsx` —
250 total) but *defines* none of them. Every chain looks like:

```css
color: var(--liminis-editor-foreground, var(--vscode-foreground));
```

with the real default declared only under the legacy name:

```css
:root { --vscode-foreground: oklch(0.35 0.01 265); }
.dark { --vscode-foreground: oklch(0.97 0.01 90 / 0.86); }
```

Zusammen, a downstream host, does not *set* this package's tokens — it
*reads* them, mapping its entire shadcn palette onto the editor's:

```css
/* zusammen: app/src/renderer/index.css */
--background: var(--vscode-background);
--foreground: var(--vscode-foreground);
--border:     var(--vscode-border);
```

It wants those reads on the `--liminis-editor-*` vocabulary instead, but
there is nothing to migrate to: the package defines real values for legacy
names only, and zero `--liminis-editor-*` names, at all. This is [ADR-092](../../docs/decisions/adr-092.md)'s
deferred **Item 3** (originally raised in #79), and
[verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129) is
blocked on it.

### The trap

The naive fix — adding `--liminis-editor-foreground: <default>;` to `:root`
— silently disables the [ADR-087](../../docs/decisions/adr-087.md) fallback
layer. Once the package's own `:root` declares the new name unconditionally,
every one of the 250 consumption chains resolves there before ever reaching
`var(--vscode-foreground)`, which becomes dead code. A host that supplies
only the legacy name is then ignored — with no error and no failing test,
because an unresolved-then-overridden CSS custom property fails silently.
That is exactly the failure mode ADR-092 and its parent issue (#79) exist to
guard against, just on the definition side instead of the consumption side.

This is not hypothetical. `liminis-app` (a sibling host in this
organization) supplies `--color-primary` and `--color-muted-foreground` —
its own Tailwind `@theme` tokens — and `C4Component.tsx` already falls back
to exactly those two legacy names (`var(--liminis-editor-primary,
var(--color-primary, #3b82f6))`) for the diagram's primary/muted colors. A
naive definition of `--liminis-editor-primary` in the package's own `:root`
would make that host's diagram colors stop tracking `--color-primary`, with
nothing in CI or the console pointing at the cause.

### The shape that avoids the trap

Defining the new name *in terms of* the legacy one, rather than
independently, satisfies all four constraints at once:

```css
:root {
  --liminis-editor-foreground: var(--vscode-foreground);
}
```

| | |
|---|---|
| Package defines the new name | Zusammen can read it |
| Host sets the new name | Wins by cascade over the package's `:root` |
| Host sets only the legacy name | Still wins — the definition consults it |
| Consumption sites | Can simplify to a single `var(--liminis-editor-x)` |

This shape is illustrative of one way to satisfy the requirements below —
it is not itself a requirement. Whether the legacy names keep carrying the
real defaults (as shown) or the defaults move onto the new names with
legacy names becoming reverse aliases is a design decision left to Plan
(see Assumptions).

**A claim in this shape needs verification, not just assumption**: CSS
custom properties resolve against the *element's own* cascade at the point
of use, so a single alias declared once in `:root` should still pick up a
`.dark`-block (or other selector) override of the legacy name it points to,
without needing a second alias declaration per theme block. Today there are
three definition sites per token that would need this property to hold:
`:root`, `.dark`, and a third site — an `@media print { :root, .dark { ... } }`
block (around line 2437 of `src/styles.css`) that resets several tokens to
print-safe literal colors. (The issue that originated this text called the
third site a "high-contrast block"; there is no separate high-contrast
media block in `src/styles.css` today — the third definition site is this
print-reset block. This spec corrects that description; whichever stage
implements the fix should verify against current source, not this
description.) Whatever mechanism Plan chooses must be verified — by
computed style in a running app, not by reading CSS — to resolve correctly
through all three sites, not assumed to work from the single-`:root`-alias
theory alone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A host reads the new vocabulary directly (Priority: P1)

Zusammen (or any host) reads `var(--liminis-editor-background)` /
`var(--liminis-editor-foreground)` / `var(--liminis-editor-border)` etc.
directly, instead of reading the legacy `--vscode-*` names, and gets the
package's real, resolved color — matching what it previously got by reading
the legacy name.

**Why this priority**: This is the entire point of the issue — today there
is nothing for Zusammen to migrate its reads to, and
[zusammen#129](https://github.com/verveguy/zusammen/issues/129) is blocked
on it.

**Independent Test**: In a running host with no theming overrides supplied,
compare the computed value of `--liminis-editor-background` (and the same
for `foreground`, `border`) against the computed value of the legacy name it
replaces. They match.

**Acceptance Scenarios**:

1. **Given** a host that mounts the editor with no CSS custom property
   overrides of its own, **When** the host reads
   `getComputedStyle(el).getPropertyValue('--liminis-editor-foreground')`,
   **Then** it returns a real, non-empty value equal to what
   `--vscode-foreground` resolves to today, in both light and dark mode.
2. **Given** the same setup, **When** the host reads every
   `--liminis-editor-*` name corresponding to a token this package consumes,
   **Then** every one of them resolves to a real value (none is empty or
   `initial`).

---

### User Story 2 - A host supplying only legacy names is unaffected (Priority: P1)

`liminis-app` (or any host) continues to supply only legacy-named overrides
(e.g. `--color-primary`, `--color-muted-foreground`, or a `--vscode-*` name)
and the editor's theming — including anything now resolved via the new
`--liminis-editor-*` definitions — continues to reflect the host's override,
exactly as before this change.

**Why this priority**: This is the regression this issue exists to prevent.
The issue's own "trap" analysis identifies that the obvious implementation
breaks this silently, with no failing test — so this scenario is the
highest-priority thing to protect, not just to add.

**Independent Test**: In a running host, set only a legacy custom property
(e.g. `--color-primary: red` on a host ancestor element, or `--vscode-border:
lime`) and read the corresponding `--liminis-editor-*` property's computed
value on the editor element. It reflects the host's override, not the
package's own default.

**Acceptance Scenarios**:

1. **Given** a host that sets only `--vscode-foreground` (no
   `--liminis-editor-foreground`), **When** computed style is read on an
   editor element, **Then** `--liminis-editor-foreground` (and anything
   consuming it) resolves to the host's `--vscode-foreground` value, not the
   package's own default.
2. **Given** `liminis-app`'s current setup — `--color-primary` and
   `--color-muted-foreground` set, nothing else — **When** the C4 diagram
   component renders, **Then** its primary/muted colors still track those
   two host-supplied values, unchanged from before this issue's change.
3. **Given** a host that sets a legacy name on `.dark` (or relies on the
   package's own `.dark` block, or the `@media print` block) rather than
   `:root`, **When** computed style is read in that context, **Then** the
   corresponding `--liminis-editor-*` name still resolves correctly in that
   context too — the three-definition-site structure described in
   Background does not break the alias.

---

### User Story 3 - A host supplying the new names overrides correctly (Priority: P2)

A host sets `--liminis-editor-*` names directly (the intended long-term
vocabulary) and those values win, exactly as setting any other CSS custom
property on an ancestor would.

**Why this priority**: Necessary for the new vocabulary to be usable at all,
but lower-risk than User Story 2 — cascade precedence for a host-set name
over a package `:root` default is standard CSS behavior, not the trap this
issue is about.

**Independent Test**: In a running host, set `--liminis-editor-foreground:
green` and confirm the editor's foreground renders green, regardless of
whatever legacy name is also present.

**Acceptance Scenarios**:

1. **Given** a host that sets `--liminis-editor-foreground` and also sets
   `--vscode-foreground` to a different value, **When** computed style is
   read, **Then** `--liminis-editor-foreground`'s own value wins.

---

### User Story 4 - The defined-token baseline guard covers the new names (Priority: P2)

The [ADR-092](../../docs/decisions/adr-092.md) checked-in baseline
(`scripts/lib/theming-defined-tokens-baseline.json`), which fails CI if a
previously-baselined defined token's declaration disappears, includes every
newly-added `--liminis-editor-*` definition, so a future accidental removal
of one of these new definitions is caught the same way a removal of a
legacy definition already is.

**Why this priority**: Without this, the new definitions this issue adds
are exactly as unprotected against silent removal as every other defined
token was before #79/ADR-092 existed — the guard this issue's own
prerequisite work built would not cover its own output.

**Independent Test**: After the change, delete one of the new
`--liminis-editor-*` declarations from `styles.css` without updating the
baseline, and run the test suite. It fails, naming that token.

**Acceptance Scenarios**:

1. **Given** the new `--liminis-editor-*` definitions are in place,
   **When** `pnpm docs:theming-baseline` is run and the result committed,
   **Then** `scripts/lib/theming-defined-tokens-baseline.json` includes
   every one of them.
2. **Given** that updated baseline, **When** `pnpm test` runs, **Then** the
   ADR-092 guard passes.
3. **Given** that updated baseline, **When** a maintainer later deletes one
   of the new declarations without updating the baseline again, **Then**
   `pnpm test` fails, naming that specific token.

---

### Edge Cases

- `--vscode-errorForeground` and `--vscode-focus-border` are consumed (5
  sites and 1 site respectively) but have **no** `:root`/`.dark` declaration
  today — their only existing "default" is a literal color inlined as the
  innermost fallback at each consumption site (e.g. `var(--vscode-focus-border,
  #007acc)`). There is no existing legacy custom property for a new
  `--liminis-editor-*` alias to point to for these two. Whatever mechanism
  is chosen for these two tokens specifically is a Plan-level decision (see
  Assumptions); this spec's requirement is only that a
  `--liminis-editor-errorForeground` and a `--liminis-editor-focus-border`
  end up genuinely defined, per FR-001, without changing what a host
  supplying nothing currently sees.
- `--vscode-errorForeground`'s literal inline fallback is **not consistent
  across its own consumption sites today**: two sites use `#f14c4c`
  (`.editor-link-broken` and its `:hover`) and two others use `#f44336`
  (`.block-delete-button:hover .block-delete-icon` and
  `.search-close-button:hover`). This is a pre-existing inconsistency, not
  something this issue introduces or is required to fix — but a single
  canonical default value baked into a new `--liminis-editor-errorForeground`
  definition would necessarily match one of these and differ from the
  other's current rendered color at a host supplying nothing, unless the
  chosen mechanism preserves per-site literals as an outer fallback. Flag
  this for whoever implements it; do not silently pick one value without
  noting the visual delta at the other sites.
- The `@media print { :root, .dark { ... } } ` block (Background) resets six
  tokens to print-safe literal colors and is a third per-token override
  context beyond `:root` and `.dark`. It must continue to work for any
  token it touches once that token gets a `--liminis-editor-*` alias.
- Consumption of these tokens is not limited to `styles.css` — five `.tsx`
  files build fallback chains into inline style strings (notably
  `C4Component.tsx`, which is where `liminis-app`'s `--color-primary`/
  `--color-muted-foreground` fallback actually lives). Any verification of
  "no visual change" must include these files' rendered output, not only
  CSS-driven elements.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package MUST declare, with a real value, a
  `--liminis-editor-<name>` custom property for every token it currently
  consumes via a `--liminis-editor-<name>` fallback chain — across
  `styles.css` and the five `.tsx` files listed in Background — including
  the two tokens (`--liminis-editor-errorForeground`,
  `--liminis-editor-focus-border`) that have no existing legacy `:root`/
  `.dark` declaration to alias to.
- **FR-002**: For a host supplying no theming overrides at all, every
  visible/computed style produced by this package MUST be unchanged before
  and after this change, in every theming context the package itself
  defines (`:root` light default, `.dark`, and the `@media print` block) —
  verified by computed style in a running app, not by reading CSS.
- **FR-003**: For a host supplying only a legacy-named override (any of
  `--vscode-*`, `--slashmd-*`, `--color-*`, `--checkbox-*`, or a standalone
  legacy name — the four families ADR-087 renamed), the corresponding
  `--liminis-editor-*` property's computed value MUST reflect that
  host-supplied override, not the package's own default — verified by
  computed style in a running app.
- **FR-004**: For a host supplying a `--liminis-editor-*` name directly, that
  value MUST win over any legacy name also present (host or package),
  matching ordinary CSS cascade precedence.
- **FR-005**: The [ADR-092](../../docs/decisions/adr-092.md) checked-in
  baseline (`scripts/lib/theming-defined-tokens-baseline.json`) MUST be
  updated, in a change associated with this issue, to include every newly
  defined `--liminis-editor-*` name, so the existing CI guard protects the
  new definitions against future silent removal.
- **FR-006**: The README's generated theming table (`scripts/generate-theming-docs.mjs`,
  guarded for staleness by `tests/theming-contract.test.ts` per ADR-085)
  MUST remain accurate and non-stale after this change — including its
  "Has a default" column, whose meaning ADR-087 fixed at "No (inline
  fallback only)" for every row on the premise that `--liminis-editor-*`
  names were never declared directly; this issue changes that premise for
  every row and the generated table and its surrounding prose must reflect
  the new reality accurately, not merely continue passing a stale check.
- **FR-007**: zusammen#129's intended read migration (`--background`,
  `--foreground`, `--card`, `--popover`, `--secondary`, `--border`,
  `--input`, and any other shadcn variable it currently maps onto a
  `--vscode-*` name) MUST be able to read the corresponding
  `--liminis-editor-*` name instead and get an identical resolved value in
  every host-override state Zusammen currently exercises — verified by
  computed style, not by reading CSS.

### Key Entities

- **Legacy name**: A pre-`0.2.0` custom property name (`--vscode-*`,
  `--slashmd-*`, `--color-*`, `--checkbox-*`, or a standalone legacy name)
  that today carries a token's real default declaration and is the fallback
  target a host overriding only the old vocabulary relies on (ADR-087).
- **`--liminis-editor-*` name**: The package's current, package-owned public
  vocabulary. Consumed everywhere already; not defined (declared with a
  value) anywhere before this issue.
- **Definition site**: A place in `styles.css` where a token is declared
  with a value — today `:root`, `.dark`, and the `@media print` block are
  the three that exist.
- **Consumption site**: A `var(--liminis-editor-<name>, ...)` reference,
  either in `styles.css` (224 sites) or inline in one of five `.tsx` files
  (26 more sites, 250 total).
- **ADR-092 baseline**: The checked-in JSON array of defined-token names
  (`scripts/lib/theming-defined-tokens-baseline.json`) that CI compares the
  live `styles.css` against, failing only on a disappearance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every token this package consumes via a `--liminis-editor-*`
  fallback chain has a corresponding real-valued `--liminis-editor-*`
  declaration in `styles.css` — zero gaps, including the two currently
  undefined tokens named in Edge Cases.
- **SC-002**: In a running host supplying zero overrides, computed styles
  for editor-rendered elements are pixel-identical to before this change, in
  both light and dark mode and under print media.
- **SC-003**: In a running host supplying only legacy names (reproducing
  `liminis-app`'s current `--color-primary`/`--color-muted-foreground`
  setup), the C4 diagram component's colors are unchanged from before this
  change.
- **SC-004**: In a running host supplying only `--liminis-editor-*` names,
  those values are the ones rendered.
- **SC-005**: `pnpm test` passes with the ADR-092 baseline including every
  newly defined name, and fails (naming the token) if one of the new
  definitions is later deleted without a baseline update.
- **SC-006**: A reviewer following zusammen#129 can migrate its reads from
  `--vscode-*` to the equivalent `--liminis-editor-*` names and observe no
  visual change, verified by computed style in a running Zusammen instance.

## Assumptions

- **Direction of the alias is a Plan-level decision, not fixed by this
  spec.** The illustrated shape in Background — legacy names keep carrying
  real defaults, new names are declared as `var(--legacy-name)` aliases in
  `:root` — satisfies every FR/SC above and is the shape the issue that
  originated this work proposed. An inverse direction (new names carry the
  real defaults, legacy names become reverse aliases) was also raised as a
  candidate; it reads cleaner but reverses which name a host must override
  to win and would require rethinking the consumption-side fallback order
  ADR-087 established, not just the definition side. This spec does not
  choose between them — it requires only that whichever is chosen satisfies
  FR-002/FR-003/FR-004.
- **`--vscode-errorForeground` and `--vscode-focus-border` need a concrete
  default value decision**, since neither has an existing legacy
  declaration to alias to. This spec's FR-001 requires they end up defined;
  it does not mandate which literal value(s) they carry, or whether the
  pre-existing `--vscode-errorForeground` inconsistency (Edge Cases) gets
  unified or preserved per-site. Left to Plan/Research.
- **Whether to also simplify the 250 existing consumption sites down to a
  single `var(--liminis-editor-x)` call** (dropping the now-redundant nested
  legacy fallback) is a cleanup goal illustrated in Background, not a hard
  requirement here — FR-002 through FR-004 hold regardless of whether
  consumption sites are simplified, since a redundant fallback chain that
  still resolves the same way is harmless. Plan may choose to do this
  cleanup in the same change or defer it.
- **Baseline update sequencing.** The issue that originated this work
  raised whether adding 40+ entries to the ADR-092 baseline in the same
  change as the new definitions makes the diff hard to review, suggesting
  it might be sequenced separately. FR-005 requires the baseline be updated
  as part of delivering this issue's acceptance criteria (a
  `--liminis-editor-*` definition with no baseline entry is unprotected
  against silent future removal, undermining SC-005/US4); whether that
  update lands in the same commit/PR as the definitions or a follow-up
  commit within the same PR is an implementation sequencing choice, not a
  scope boundary.
- Corrected from the originating issue text: the third per-token definition
  site is an `@media print` block (`src/styles.css`, around line 2437), not
  a "high-contrast" block — there is no separate high-contrast media block
  in current source. See Background.

## Out of Scope

- Removing, deprecating on a timeline, or otherwise sunsetting the legacy
  names (`--vscode-*`, `--slashmd-*`, `--color-*`, `--checkbox-*`) — this
  issue adds a new defined vocabulary alongside them; it does not change
  ADR-087's deprecation posture.
- Any change to which tokens are currently *consumed* or *documented* in
  the README's generated table's row set — this issue changes what's
  *defined*, and updates the table's "Has a default" column accuracy
  (FR-006), but does not add or remove rows.
- zusammen's own code change to actually perform its read migration — that
  lives in zusammen#129, in a different repository. This issue's scope ends
  at making the migration possible and verifiable; SC-006 covers verifying
  the *editor's* side of that, not landing Zusammen's PR.
- Fixing the pre-existing `--vscode-errorForeground` literal-value
  inconsistency between its four consumption sites as a design goal in its
  own right — only as a side effect of deciding FR-001's value for that
  token (see Edge Cases, Assumptions).

## Source References

- `src/styles.css` — the 224 in-file consumption sites; `:root` (line 2),
  `.dark` (line 65), and the `@media print` block (line ~2437) are the
  three current per-token definition sites.
- `src/app/editor/nodes/C4Component.tsx` — where `liminis-app`'s
  `--color-primary`/`--color-muted-foreground` fallback actually lives (not
  in `styles.css`).
- `src/app/editor/SelectionContextMenuPlugin.tsx`,
  `DragHandlePlugin.tsx`, `CorrectionPanelPlugin.tsx`,
  `DiagramContextMenu.tsx` — the other four files with
  `--liminis-editor-*` consumption outside `styles.css`.
- `scripts/lib/theming-tokens.mjs` — `defaultedTokens()`,
  `diffDefinedTokenBaseline()`, `PREVIOUS_NAME`, `TOKEN_DESCRIPTIONS`.
- `scripts/lib/theming-defined-tokens-baseline.json` — the ADR-092 baseline
  this issue's new definitions must be added to.
- `scripts/generate-theming-docs.mjs` — generates the README's theming
  table this issue's FR-006 requires stay accurate.
- `tests/theming-contract.test.ts` — the existing consumed-token and
  defined-token (ADR-092) guards.
- `README.md`, "Theming: CSS custom properties" section.
- `docs/decisions/adr-085.md` — the original consumed-token drift guard.
- `docs/decisions/adr-087.md` — the `--liminis-editor-*` rename and the
  fallback-chain design this issue extends to the definition side.
- `docs/decisions/adr-092.md` — the defined-token baseline guard; its "Not
  decided here" section is this issue's direct origin (Item 3 of #79).
- Issue #79, `specs/79-the-package-s-token/spec.md` — where Item 3 was
  first deferred as a follow-up.
- [verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129)
  — the downstream migration blocked on this issue.

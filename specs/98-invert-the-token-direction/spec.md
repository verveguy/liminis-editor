# Feature Specification: Invert the Token Direction — `--liminis-editor-*` Carries the Values, Legacy Names Become Shims

**Feature Branch**: `fabrik/issue-98`
**Created**: 2026-08-22
**Status**: Specified
**Input**: User description: "Move the package's real token *values* onto `--liminis-editor-*`, and reduce the legacy names to deprecated shims. Non-breaking: hosts that set or read either vocabulary keep working. This is the prerequisite for both consumers making a clean break from the legacy namespaces."

> **Correction (Implement stage, 2026-08-22):** User Story 2 and FR-002/FR-004
> below frame this change as fully non-breaking for a host **setting** only a
> legacy name ("keeps working," "still overrides visually"). That framing was
> empirically verified during Implement and found false: once every internal
> consumption site reads `--liminis-editor-*` only, nothing bridges a host's
> legacy-name override back to the package. **Reading** a legacy name still
> works exactly as this spec describes; **setting** one no longer themes the
> editor — an accepted, documented breaking change. This section is kept
> unedited as the historical record of what was planned; see ADR-98's
> "Verified, not assumed" section and `CHANGELOG.md`'s `## Unreleased` for the
> corrected, shipped behavior.

## Background

`0.3.0` (#93 / ADR-93) defined `--liminis-editor-*` names, but only as
**aliases pointing at the legacy names** — the real values still live on the
legacy side:

| | |
|---|---|
| legacy tokens the package **defines** | **87** — `--slashmd-*` 61, `--vscode-*` 21, `--checkbox-*` 3, `--editor-*` 2 |
| `--liminis-editor-*` names | 65, **all** of them `var(--legacy-name, …)` forwards |
| aliases whose target the package never defines, so they bake a **literal** | **23** |

So the legacy dependence isn't in the apps — they already read
`--liminis-editor-*`. It's in the package: those names forward to
`--slashmd-*`/`--vscode-*`, and that's where the real values are declared.

**Why this blocks the consumers, concretely.** verveguy/zusammen#134 migrated
its shadcn palette onto `--liminis-editor-*` and had to leave three tokens
behind, because those aliases lead to a literal rather than a value:

```css
--liminis-editor-primary:         var(--color-primary, #3b82f6)
--liminis-editor-errorForeground: var(--vscode-errorForeground, #f14c4c)
--liminis-editor-focus-border:    var(--vscode-focus-border, #007acc)
```

Wiring Zusammen's `--primary` to the first would have replaced its purple
brand colour with an unrelated blue — a visible, app-wide regression.
`--color-primary` has **zero** definitions anywhere in this package; the
alias only ever echoed a Tailwind token name that happens to exist in a
different app (liminis-app), coincidentally reachable through
`C4Component.tsx`'s own fallback chain. That's not a Zusammen problem to
work around — it's this package handing out an alias that doesn't lead
anywhere it actually owns.

**The fix is to invert the direction:**

```css
/* today */
--vscode-foreground: oklch(0.35 0.01 265);
--liminis-editor-foreground: var(--vscode-foreground);

/* after */
--liminis-editor-foreground: oklch(0.35 0.01 265);
--vscode-foreground: var(--liminis-editor-foreground);   /* deprecated shim */
```

Three consequences, all wanted:

1. **Hosts reading `--liminis-editor-*` get real values**, including the 23
   that currently bake a literal.
2. **Hosts still setting legacy names keep working.** The shim is read by
   nothing inside the package, but a host that sets `--vscode-foreground`
   still overrides visually, because the package's own CSS consumes
   `--liminis-editor-foreground` and the host's declaration on the shim
   name only matters if something still reads it — which nothing inside the
   package does after this change, so the *host's* override must instead be
   picked up by whatever bridges `--vscode-foreground` back into
   `--liminis-editor-foreground`. **This must be verified in a running app
   via computed styles, not assumed from reading the CSS** — it's the crux
   of the change staying non-breaking, and liminis-app sets
   `--color-primary` and `--color-muted-foreground` today, which must keep
   working unchanged.
3. **`--liminis-editor-primary` stops forwarding an undefined token.** #93
   only ever echoed liminis-app's own Tailwind fallback because the package
   asserted no value of its own; this issue treats that as a defect to
   correct, not a default to preserve as-is.

This is the prerequisite for both `zusammen` and `liminis-app` to eventually
drop the legacy namespaces entirely (a later, breaking `0.4.0` — see Out of
Scope). Neither can do that today, because the values they'd be depending on
by dropping the legacy read still live under the legacy names.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A host reads `--liminis-editor-*` directly and gets a real value (Priority: P1)

A downstream app (e.g. Zusammen) maps its own design tokens onto this
package's `--liminis-editor-*` custom properties, expecting each to resolve
to the package's actual intended value — not a forwarded legacy name, and
not a literal borrowed from an unrelated app's fallback chain.

**Why this priority**: This is the entire point of the issue — #93 shipped
the names but not the values, and that gap is actively blocking a
downstream migration (verveguy/zusammen#134).

**Independent Test**: For every one of the 65 `--liminis-editor-*` names,
inspect `styles.css` and confirm the declaration's right-hand side is a
literal value (or a value built only from other `--liminis-editor-*`
names), never a `var(--vscode-...)`, `var(--slashmd-...)`, or
`var(--checkbox-...)` reference.

**Acceptance Scenarios**:

1. **Given** a host page with no custom theming applied, **When** the
   computed style of `--liminis-editor-foreground` is read on `:root`,
   **Then** it resolves to the package's intended default value directly,
   not through a legacy-named intermediary.
2. **Given** the same unthemed host, **When** the computed value of each of
   the 65 `--liminis-editor-*` names is read, **Then** it is identical to
   the value that name resolved to immediately before this change (i.e. the
   inversion is a value-preserving refactor for every name except
   `--liminis-editor-primary`, see User Story 3).

---

### User Story 2 - A host that only sets legacy names keeps working (Priority: P1)

An existing integration (e.g. liminis-app) themes the editor by setting only
legacy custom properties (`--color-primary`, `--color-muted-foreground`, and
by extension any `--vscode-*`/`--checkbox-*`/`--editor-*` name a host might
plausibly set) and has never been updated to know about
`--liminis-editor-*`. It must continue to theme correctly after this change,
with no code change on its side.

**Why this priority**: This is what makes the change non-breaking. Getting
this wrong silently strips theming from every existing integration the day
this ships.

**Independent Test**: In a running app, set only a legacy custom property
(e.g. `--vscode-foreground`) at `:root`, read the computed style of the
element that visually depends on it, and confirm it reflects the override —
not the package's default.

**Acceptance Scenarios**:

1. **Given** a host that sets only `--vscode-foreground: red` at `:root`
   and never sets `--liminis-editor-foreground`, **When** the computed
   color of editor body text is read, **Then** it is red.
2. **Given** liminis-app's existing `--color-primary` and
   `--color-muted-foreground` overrides, unmodified, **When** the app is
   run after this change, **Then** its themed appearance is pixel-for-pixel
   unchanged from before this change.
3. **Given** the package's own `@media print` block, which today overrides
   several `--vscode-*` and `--slashmd-*` names for print output, **When**
   a page is printed after this change, **Then** print styling (black text
   on white background, simplified colors) is unchanged — this block must
   be updated to override `--liminis-editor-*` names (whichever mechanism
   the package's own CSS now actually consumes), since a host-facing legacy
   override and the package's own internal print override face the same
   "nothing inside the package reads the legacy name anymore" consequence.

---

### User Story 3 - A host that sets `--liminis-editor-*` directly always wins (Priority: P2)

A host that has already migrated to `--liminis-editor-*` (per User Story 1)
sets one of those names directly. Its override must take priority over both
the package's own default and any legacy-named shim value.

**Why this priority**: This guarantee already exists today (ADR-93) and must
not regress — it's lower priority than P1 here only because inversion, done
correctly, preserves it structurally (the host's direct declaration on
`--liminis-editor-*` is closer to the point of use than either the
package's own `:root` default or the legacy shim behind it).

**Independent Test**: Set `--liminis-editor-foreground` directly on a host
page, alongside a conflicting legacy `--vscode-foreground`, and confirm the
`--liminis-editor-foreground` value wins.

**Acceptance Scenarios**:

1. **Given** a host that sets both `--liminis-editor-foreground: blue` and
   `--vscode-foreground: red` at `:root`, **When** the computed color of
   editor body text is read, **Then** it is blue.

---

### User Story 4 - `--liminis-editor-primary` resolves to a deliberate value (Priority: P2)

`--liminis-editor-primary` currently forwards to `--color-primary`, a
Tailwind token this package never defines — it exists only in liminis-app.
After this change, it must resolve to a value the package itself owns and
intends, decided as part of this work rather than left as an artifact of
#93's alias mechanics.

**Why this priority**: Explicitly called out by this issue as a defect, but
it affects one token (plus its `-100` tint companion), not the breadth of
the rest of the change.

**Independent Test**: Confirm `--liminis-editor-primary`'s (and
`--liminis-editor-primary-100`'s) declaration in `styles.css` does not
reference `--color-primary`, `--color-primary-100`, or any other name this
package does not itself declare a value for.

**Acceptance Scenarios**:

1. **Given** a host with no theming applied, **When** the computed value of
   `--liminis-editor-primary` is read, **Then** it is a value the package
   deliberately declares (e.g. drawn from the package's own existing brand
   token, `--editor-brand`, or some other intentional choice recorded in
   the implementation's ADR) — not `#3b82f6` inherited by coincidence from
   an unrelated app's fallback.
2. **Given** the value chosen in Scenario 1, **When** it is documented,
   **Then** the choice and rationale are recorded in this change's ADR,
   satisfying this repository's "record what a decision costs" convention
   for a token whose computed value is intentionally changing.

---

### Edge Cases

- **The `@media print` block** (`src/styles.css`) currently sets several
  `--vscode-*` and `--slashmd-*` names directly, as the package's own
  internal override — not a host integration. Since `--slashmd-*` is being
  deleted entirely and nothing inside the package will read `--vscode-*`
  after inversion, this block must be migrated to override whatever names
  the package's print-relevant consumption sites actually resolve through,
  or print output silently reverts to screen colors. See User Story 2,
  Acceptance Scenario 3.
- **`--vscode-*` names with no prior declaration.** 13 of the 21
  `--vscode-*` names in the "legacy tokens the package defines" count (e.g.
  `--vscode-button-background`, `--vscode-menu-background`) are not
  currently declared as a CSS custom property anywhere — they exist only as
  the fallback name inside a `var(--vscode-x, <literal>)` chain. After
  inversion, per the proposed pattern, these become newly and explicitly
  declared as shims (`--vscode-button-background: var(--liminis-editor-button-background);`).
  This is in scope: "the ones a host plausibly sets" (per the issue's scope
  decision) includes all 21 `--vscode-*` names, not only the subset
  previously declared.
- **Dark-mode-only and light-mode-only literal divergences.** ADR-93
  recorded that two token families (`--vscode-errorForeground` /
  `--vscode-toolbar-hoverBackground`) had inconsistent literal values across
  call sites and picked one canonical value for the `--liminis-editor-*`
  alias. That canonical choice, not the pre-ADR-93 per-site literals, is
  what this issue's "same computed value as before this change" acceptance
  criterion is measured against for those two families.
- **A host setting a legacy name on a DOM element other than `:root`/
  `document.documentElement`.** ADR-93 already scoped its "legacy name
  still wins" guarantee to `:root`/`document.documentElement` and explicitly
  did not extend it to an arbitrary descendant element, for CSS-inheritance
  reasons recorded there. This issue inherits that same scope boundary — it
  is not expanding it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every `--liminis-editor-*` custom property MUST be declared in
  `src/styles.css` with its own literal value (or a value built only from
  other `--liminis-editor-*` names) — never as a `var()` forward to a
  `--vscode-*`, `--slashmd-*`, or `--checkbox-*` name.
- **FR-002**: Every `--vscode-*`, `--checkbox-*`, and `--editor-*` name
  currently reachable in `src/styles.css` (26 names: 21 `--vscode-*`, 3
  `--checkbox-*`, 2 `--editor-*`) MUST remain settable by a host and MUST
  continue to produce the same visible effect as before this change, via a
  shim that resolves through the corresponding `--liminis-editor-*` name.
- **FR-003**: No code inside this package (`src/**`, including
  `src/styles.css`'s own non-shim rules) may read a `--vscode-*`,
  `--slashmd-*`, or `--checkbox-*` custom property after this change — all
  internal consumption sites read `--liminis-editor-*` only.
- **FR-004**: A host that sets a legacy name (`--vscode-*`, `--checkbox-*`,
  `--editor-*`) and never sets the corresponding `--liminis-editor-*` name
  MUST see the legacy override take visual effect, verified via computed
  styles in a running app for at least the tokens liminis-app currently
  overrides (`--color-primary`, `--color-muted-foreground`) plus one
  `--vscode-*` example.
- **FR-005**: A host that sets a `--liminis-editor-*` name directly MUST see
  that value win over any conflicting legacy-named value, unchanged from
  today's guarantee (ADR-93, User Story 3).
- **FR-006**: All 61 `--slashmd-*` custom properties MUST be removed from
  `src/styles.css` — no shim is created for them (verified: zero
  `--slashmd-` references in `verveguy/zusammen` or `verveguy/liminis`).
- **FR-007**: The package's `@media print` block MUST be updated so print
  output is unchanged after `--slashmd-*` removal and the inversion (see
  Edge Cases).
- **FR-008**: `--liminis-editor-primary` (and `--liminis-editor-primary-100`)
  MUST resolve to a value this package deliberately declares, not a
  forward to `--color-primary`/`--color-primary-100` or any other name the
  package does not itself define.
- **FR-009**: The checked-in defined-token baseline
  (`scripts/lib/theming-defined-tokens-baseline.json`, guarded by
  `tests/theming-contract.test.ts` per ADR-092) MUST be regenerated to match
  the post-change set of defined tokens — reflecting the 61 `--slashmd-*`
  removals and any newly-declared shim names from FR-002.
- **FR-010**: `README.md`'s generated theming token table MUST stay in sync
  with the post-change source (`node scripts/generate-theming-docs.mjs`),
  per the existing `theming-contract.test.ts` drift guard.
- **FR-011**: For every one of the 65 `--liminis-editor-*` names except
  `--liminis-editor-primary`/`--liminis-editor-primary-100`, the computed
  value a host with no theming applied observes MUST be identical before
  and after this change.

### Key Entities

- **`--liminis-editor-*` custom property**: The package's public,
  currently-forwarding-only token vocabulary; becomes the canonical
  value-bearing vocabulary after this change.
- **Legacy custom property** (`--vscode-*`, `--slashmd-*`, `--checkbox-*`,
  `--editor-*`): The package's original, pre-`0.2.0` token vocabulary.
  `--slashmd-*` is removed entirely; the other three families become
  deprecated shims.
- **Defined-token baseline**
  (`scripts/lib/theming-defined-tokens-baseline.json`): The checked-in
  record (ADR-092) of every custom property `styles.css` declares, guarding
  against silent removal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `grep`-ing `src/styles.css` for `--liminis-editor-[a-zA-Z-]+:\s*var\(--(vscode|slashmd|checkbox)-` (a `--liminis-editor-*` declaration whose value is a legacy-name forward) returns zero matches.
- **SC-002**: `grep`-ing `src/styles.css` for `--slashmd-` returns zero matches.
- **SC-003**: In a running app, a host supplying only legacy custom properties (no `--liminis-editor-*`) themes identically to how it did before this change, confirmed via computed styles for at least the tokens enumerated in FR-004.
- **SC-004**: In a running app, computed values for all 65 `--liminis-editor-*` names, read with no host theming applied, match their pre-change computed values — except `--liminis-editor-primary`/`--liminis-editor-primary-100`, whose new values are the deliberate choice from FR-008.
- **SC-005**: `pnpm test` (including `tests/theming-contract.test.ts`'s baseline-drift and README-drift guards) passes with the regenerated baseline and README.

## Assumptions

- "Deprecated" for the legacy shim names means: still functional (a host
  supplying them keeps working), documented as deprecated, but not removed
  in this issue. Removal is explicitly Out of Scope (see below) and gated
  by a future, separate breaking release.
- The 87/65/23 counts in the Background section are as reported by the
  issue author from direct inspection of `0.3.0`; this issue does not
  require re-deriving them from scratch, only that the stated behavior
  (every `--liminis-editor-*` name is currently a forward) is corrected.
- "A host plausibly sets" (scope boundary for which legacy names get shims)
  is read as: all 21 `--vscode-*`, all 3 `--checkbox-*`, and both
  `--editor-*` names — i.e. every legacy name that is not `--slashmd-*`,
  regardless of whether that name currently has its own `:root` declaration
  or exists today only inside a fallback chain.
- Verifying the non-breaking guarantee (User Story 2, FR-004) requires a
  running app with computed-style inspection (e.g. browser automation),
  not a CSS-source-only check — this is an explicit instruction from the
  issue, not an implementation detail left to Plan/Implement to relax.

## Out of Scope

- **Removing the legacy shims.** That is a breaking change and comes after
  both `zusammen` and `liminis-app` have migrated off the legacy
  vocabulary entirely — a later `0.4.0`. The defined-token baseline (FR-009)
  will fail CI on that removal until it's deliberately updated, which is
  the intended guard.
- **Migrating `zusammen` or `liminis-app`'s own source** to read
  `--liminis-editor-*` where they don't already. Those are changes in
  their respective repositories.
- **Choosing new values for any `--liminis-editor-*` name other than
  `primary`/`primary-100`.** Every other name's value is a direct carry-over
  of its current effective default (FR-011) — this issue is a refactor of
  *where* the value lives, not a redesign of the theme, except where FR-008
  explicitly requires a new value.

## Source References

- Issue #93 / `docs/decisions/adr-93-liminis-editor-defined-aliases.md` —
  the alias mechanism this issue inverts, including the "legacy name still
  wins" cascade reasoning and its documented `:root`/descendant-element
  scope boundary.
- `docs/decisions/adr-092.md` — the checked-in defined-token baseline
  mechanism (FR-009). Note: the original issue text cites this as
  "ADR-091"; `docs/decisions/adr-091.md` is unrelated (`DocumentOutlineHandle`,
  issue #84). The correct reference for the defined-token baseline is
  **ADR-092** (issue #79).
- `docs/decisions/adr-087.md` (#51) — the original consumption-side rename
  to `--liminis-editor-*`, and the fallback-preservation requirement
  `tests/theming-contract.test.ts` still enforces today.
- `tests/theming-contract.test.ts`, `scripts/lib/theming-tokens.mjs` — the
  existing drift guards this issue's changes must keep passing (README
  sync, baseline sync, fallback-chain checks).
- `src/styles.css` — all declaration and consumption sites in scope.
- verveguy/zusammen#134 — the downstream migration this issue unblocks.
- verveguy/zusammen#129 — the original request that led to #93 defining the
  `--liminis-editor-*` names in the first place.

# ADR-98: Invert the Token Direction — `--liminis-editor-*` Carries the Values, Legacy Names Become Shims

**Date:** 2026-08-22
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #98 (verveguy/liminis-editor)

## Context

ADR-93 (#93) gave every `--liminis-editor-*` name a real `:root`/`.dark`
declaration, but as a forward to its legacy name —
`--liminis-editor-foreground: var(--vscode-foreground);`. The real values
kept living on the legacy side. That was a deliberate, narrow fix for a
narrow problem (a host reading `--liminis-editor-*` got nothing at all,
zusammen#129); it was never the end state, and ADR-092's own "Not decided
here" section named the inversion as an open item.

The narrowness became a concrete defect. verveguy/zusammen#134 migrated its
shadcn palette onto `--liminis-editor-*` and had to leave three tokens
behind, because their aliases lead to a literal, not a value:
`--liminis-editor-primary: var(--color-primary, #3b82f6)`,
`--liminis-editor-errorForeground: var(--vscode-errorForeground, #f14c4c)`,
`--liminis-editor-focus-border: var(--vscode-focus-border, #007acc)`. Wiring
Zusammen's `--primary` to the first would have replaced its purple brand
colour with an unrelated blue — a visible, app-wide regression, and not a
Zusammen problem to work around: `--color-primary` has zero definitions in
this package, so the alias never led anywhere real to begin with.

**Verified against the current codebase, not the issue's approximate
counts** (the spec's own Assumptions permit this — Implement diffs against
real source, not the issue's illustrative numbers):

- 59 `--liminis-editor-*` names are declared (the issue said 65).
- 26 legacy names need a shim: 24 distinct `--vscode-*` names,
  `--checkbox-border`, and `--editor-brand`.
- The 61 `--slashmd-*` names need no shim — verified zero hits across both
  `verveguy/zusammen` and `verveguy/liminis` (the one `slashmd` string that
  does appear, `.slashmd-editor`, is an unrelated CSS class name). They are
  upstream vocabulary no known consumer reads, so #98 deletes them outright.
- `--slashmd-heading-color` is declared three times (twice in the `:root`/
  `.dark` blocks ADR-93 left in place, once in `@media print`) but consumed
  nowhere and has no `--liminis-editor-*` counterpart — dropped entirely,
  including from the print block, rather than inventing one.
- Exactly 10 `var(--color-*)` references exist in `src/`: 4 in the
  `styles.css` alias block this ADR deletes, and 6 in `C4Component.tsx`
  (the C4 diagram layout-toggle buttons) — the only place
  `--color-primary`/`--color-muted-foreground`/their `-100` variants are
  read anywhere in this package.

## Decision

**Invert the direction.** Each `--liminis-editor-*` name now carries its own
literal (or, for two names, a value built only from another
`--liminis-editor-*` name) at `:root`/`.dark`. Each of the 26 legacy names
above becomes a one-line shim, `<legacy>: var(--liminis-editor-x);`, in a
new `:root`-only block — no `.dark` duplicate is needed, since
`var(--liminis-editor-x)` re-resolves against whichever cascade value is
active at the point of use, the same reasoning ADR-93 already relied on in
the opposite direction. **The physical structure of `styles.css`'s two
blocks swaps roles, not position**, so the diff reads as "these two blocks
traded places" rather than a scrambled rewrite.

### Verified, not assumed: the shim preserves reads, not writes

The issue asked for this to be verified, not assumed, and it was — with a
real, corrected finding, not a confirmation of the original premise. The
issue's own proposed mechanism claimed a host *setting* only a legacy name
would still theme the editor, "because the package consumes
`--liminis-editor-foreground` and the host's declaration wins by cascade."
That is false, and checking it (a static HTML fixture opened in a real
Chromium via Playwright's cached binary, then the same check repeated
against `examples/electron/e2e/theming-aliases.spec.ts`'s running shell)
shows why: a `var()` reference resolves the cascade of the *exact* property
name written inside it. `--liminis-editor-foreground`'s own declaration is
a literal, containing no reference to `--vscode-foreground` at all — so a
host's override of `--vscode-foreground` changes what `--vscode-foreground`
itself computes to, and nothing else. Nothing inside this package reads
`--vscode-foreground`, so the override never reaches the editor. Two custom
properties do not auto-synchronize; only a `var()` reference that names one
inside the other's declaration creates any relationship between them, and
here the reference runs one way only (legacy → new, in the shim), not both
— a bidirectional shim (each side referencing the other via `var()`) is a
CSS cycle, which the spec defines as producing a guaranteed-invalid value on
*both* properties, so that was never an option either.

**The corrected, accepted guarantee: a shim preserves reads, not writes.** A
host that *reads* a legacy name (e.g. Zusammen's
`--vscode-errorForeground`/`--vscode-focus-border`) still gets the real,
current value, since the shim's `var(--liminis-editor-x)` reference resolves
normally. A host that *sets* only a legacy name no longer themes the editor
— this is accepted as an intentional breaking change (see CHANGELOG's
`## Unreleased` / Breaking changes), not a regression to silently work
around, because the only alternative (`--liminis-editor-x: var(--legacy-x,
<literal>)`, checking the legacy name first at the *definition* site) would
keep the legacy name in the resolution path for every one of the 26 shimmed
tokens — reintroducing, in a new shape, the exact dependence on the legacy
vocabulary this issue exists to remove. Measured directly: neither
`liminis-app` nor Zusammen sets a legacy name today (`liminis-app` sets
`--liminis-editor-primary`/`--liminis-editor-muted-foreground`; Zusammen
only reads), so this break has no currently-known victim, and it is also
`0.2.0`'s already-announced deprecation ("removed in a future major
release") completing on schedule rather than early.
`examples/electron/e2e/theming-aliases.spec.ts` pins both halves directly
with `getComputedStyle` in a running Electron shell: a legacy-name read
still resolves, and a legacy-name-only *write* no longer reaches the
editor's computed style — a deliberate assertion of the new, documented
behavior, not a gap left uncovered.

**FR-003 ("no internal code may read a `--vscode-*`/`--slashmd-*`/
`--checkbox-*` property") is taken literally.** All CSS and TSX consumption
sites under `src/` lose their now-redundant nested `var(--legacy-x, …)`
fallback, becoming a bare `var(--liminis-editor-x)`. Every name now has an
unconditional default, so the fallback was provably dead weight, not a
safety net — the same "provably dead code" ADR-93 left in place in the
other direction, except this time removed, because leaving it would mean
this package still textually reads the legacy vocabulary FR-003 forbids.
The `@media print` block — an *internal* consumer, not a host — is migrated
the same way, overriding `--liminis-editor-*` names directly.

**`--liminis-editor-primary`/`-100` are brand-derived, not host-borrowed.**
`--editor-brand` — this package's own, already-themed purple,
`oklch(0.55 0.20 303)` light / `oklch(0.70 0.20 303)` dark — becomes
`--liminis-editor-primary`'s value directly; no new public token name is
invented. `--editor-brand` itself becomes a one-line shim,
`--editor-brand: var(--liminis-editor-primary);`.
`--liminis-editor-primary-100` becomes the same brand colour at 10% alpha,
mirroring how the existing callout tokens already derive a tint from
`--editor-brand`. This replaces the previous forward to liminis-app's
`--color-primary`/`-100` (§the issue's point 3: "this looks like a defect
introduced by #93 rather than a deliberate default") — this package never
defined `--color-primary`, so that forward never had a real value behind
it; a package-owned brand colour is a deliberate default the package
actually owns.

**`--color-primary`/`--color-muted-foreground`/their `-100` variants are not
part of this package's legacy vocabulary and stay outside FR-003's
forbidden list** (only `--vscode-*`/`--slashmd-*`/`--checkbox-*` are
forbidden). liminis-app sets `--color-primary`/`--color-muted-foreground`
today, and that override must keep working unmodified. Once
`--liminis-editor-primary`'s *definition* no longer forwards to
`--color-primary`, the only place left to preserve that override is
`C4Component.tsx`'s own 6 consumption sites — so, uniquely, those sites are
**not** simplified to a bare `var(--liminis-editor-x)` like every other
site in this package. They are reordered to
`var(--color-x, var(--liminis-editor-x))`, checking liminis-app's token
first and falling back to this package's own default, dropping only the
now-redundant third-level literal. **This is the one deliberate exception
to "strip every legacy fallback," and it is the single highest-risk spot in
this change** — a future pass that "simplifies" it to match every other
call site would silently stop liminis-app's existing override from working.
An inline comment at the site says so explicitly, not only this ADR.

> **Amended 2026-08-22 (#101) — this exception is removed.** Measured
> against both known consumers' current `main`, the two arms resolved
> identically in liminis-app (`--color-primary` and `--liminis-editor-primary`
> both trace to `var(--primary)`) and the `--color-*` arm was dead in
> Zusammen (neither `--color-primary-100` nor `--color-muted-100` was ever
> defined there). The fallback changed no observable outcome anywhere it was
> deployed, while permanently coupling this package to a host's Tailwind
> `@theme` namespace it does not define or control. `C4Component.tsx`'s six
> sites now read `var(--liminis-editor-x)` only, the same as every other
> consumption site; a host that wants to override the C4 diagram colours
> sets `--liminis-editor-primary` and its siblings, exactly as it would for
> any other token. This confirms the risk this ADR itself flagged above —
> the "single highest-risk spot" and "permanent asymmetry" — rather than
> contradicting it.

**`PREVIOUS_NAME` in `scripts/lib/theming-tokens.mjs` drops its `-primary-100`/
`-muted-foreground`/`-muted-100` entries** (they pointed at `--color-*`,
which this package never defined — keeping them implied a migration
relationship that never existed) **and repoints `-primary` at
`--editor-brand`**, the name it now genuinely shims. The map's remaining
entries (`--slashmd-*`, most `--vscode-*`) are kept as a historical
migration record for the README's "Previous name" column, even though
`--slashmd-*` itself is deleted — the record of what a token used to be
called remains useful to a host migrating an old override, and nothing
about deleting the definition requires deleting the history of the rename.

**`resolvesToPreviousName()` is deleted, not just updated, and replaced with
`LEGACY_SHIM_TARGET` + `resolvesToShimTarget()`.** The old guard's premise —
a consumption-site fallback protects a host still supplying only the legacy
name — is exactly what this ADR inverts: that protection now lives in the
`:root` shim declaration, not at the consumption site. The new guard checks
the new invariant directly: every one of the 26 legacy names in
`LEGACY_SHIM_TARGET` is declared in `styles.css` as a one-line `var()`
forward to its `--liminis-editor-*` target (FR-002), and — a second,
independent check — nothing under `src/` contains `var(--vscode-`,
`var(--slashmd-`, or `var(--checkbox-` at all (FR-003). A plain-text scan
is sufficient for the second check and more robust than the old paren-depth
-aware fallback check, because after this change there is no longer any
legitimate reason for those substrings to appear inside a `var()` call
anywhere in this package.

**One side effect of the `C4Component.tsx` exception, not separately
designed:** `scripts/lib/theming-tokens.mjs`'s `consumedTokens()` treats the
outermost (depth-0) name in a `var()` fallback chain as the "primary"
consumed name — the same logic ADR-93 relied on to keep alias declarations
out of the consumed set. Since `var(--color-x, var(--liminis-editor-x))`'s
outer argument is `--color-x`, that is now the name the README's generated
table documents at those 4 token pairs, not `--liminis-editor-primary`/
`-100`/`-muted-foreground`/`-muted-100` — those four remain fully real,
declared defaults (verified by the baseline and by `defaultedTokens()`),
just no longer the *documented-as-consumed* name at this one file's sites.
`TOKEN_DESCRIPTIONS` gains four new entries for the `--color-*` names
instead, describing the override relationship in both directions.

## Consequences

**Good:**

- A host reading `--liminis-editor-*` now gets a real value in every case,
  including the 23 aliases that previously baked a literal — the entire
  point of this issue and the prerequisite for zusammen#134's read
  migration (FR-001, SC-001).
- A host supplying only a legacy name keeps *reading* a real value, verified
  by `getComputedStyle` in a running Electron shell, not assumed from
  cascade theory alone (FR-002, FR-003) — see "Verified, not assumed" above
  for the corrected scope of this guarantee (reads, not writes).
- `--liminis-editor-primary` now resolves to a value this package actually
  owns, closing the defect the issue's point 3 named (FR-008).
- The ADR-092 baseline guard now protects the 26 shim declarations the same
  way it already protected every other definition — an accidental deletion
  of a shim fails `pnpm test`, naming the token.
- `--slashmd-*`'s 61 names are gone entirely — the largest single reduction
  in this package's declared token surface since #51, with a verified
  absence of consumers backing the removal, not a guess.

**Bad / accepted:**

- **A host that sets only a legacy name no longer themes the editor** — this
  package's initial framing of this issue called the whole change
  "non-breaking," and that framing was wrong for this one direction (see
  "Verified, not assumed" above). Accepted because the only fix would keep
  the legacy name in every shimmed token's resolution path, defeating the
  purpose of the inversion, and because neither known consumer (`liminis-app`,
  Zusammen) currently sets a legacy name — this is documented in the
  CHANGELOG's `## Unreleased` / Breaking changes as of this decision.
- **`--liminis-editor-primary`/`-100`'s new computed value is a real,
  visible change** for anything relying on the old `#3b82f6`-derived default
  rather than overriding it. This is out of this repository's control —
  `zusammen`/`liminis-app` are separate repositories — but is a deliberate,
  known consequence of FR-008, not an oversight, and is called out
  prominently in the PR description.
- **The `C4Component.tsx` `--color-*` exception is a permanent asymmetry** in
  an otherwise uniform "every consumption site reads `--liminis-editor-*`
  only" rule. It is the one place a future contributor could plausibly
  "clean up" into a silent regression against liminis-app. The inline
  comment at the site and this ADR are the two places that asymmetry is
  recorded; there is no CI guard that would catch a well-intentioned but
  wrong simplification here, because the wrong version is textually
  indistinguishable from a normal consumption site.
  > **Amended 2026-08-22 (#101) — removed.** The exception is gone; see the
  > amendment in the Decision section above. `--color-*` is now forbidden
  > under `src/` on the same footing as `--vscode-*`/`--slashmd-*`/
  > `--checkbox-*`, with no per-file carve-out.
- **The README's generated token table no longer lists
  `--liminis-editor-primary`/`-100`/`-muted-foreground`/`-muted-100` as
  their own rows** — `--color-primary`/`-100`/`-muted-foreground`/`-muted-100`
  appear instead, as a direct consequence of which name is "outermost" in
  `C4Component.tsx`'s reordered fallback chain (see Decision). The four
  `--liminis-editor-*` names remain fully real, declared, overridable
  defaults; they are simply not the *documented-as-consumed* name at this
  one file's sites. A future contributor auditing "does every
  `--liminis-editor-*` name have a row in the README" needs to know this
  before treating the absence as a bug.
- **`--editor-brand` was never itself part of `PREVIOUS_NAME`'s renamed-token
  history before this change** (it had no consumption site to preserve a
  fallback for), so its entry is new, not migrated — a minor asymmetry with
  every other `PREVIOUS_NAME` entry, which all trace back to #51.

**Neutral:**

- `scripts/lib/theming-tokens.mjs`'s `consumptionSitesIn()`/
  `isCustomPropertyDeclarationValue()` machinery (ADR-93) needed no change:
  it is direction-agnostic, and correctly treats this ADR's new shim
  declarations as declaration-side values, not consumption sites, the same
  way it treated ADR-93's aliases.
- `resolvesWithoutHost()` needed no change either: once every
  `--liminis-editor-*` name has a real `:root`/`.dark` declaration, a bare
  `var(--liminis-editor-x)` with no fallback resolves without a host by
  construction — the guard's existing logic already covers this.

## References

- Issue #98 (this decision); ADR-092's "Not decided here," Item 3 — this
  decision's direct origin
- `docs/decisions/adr-93-liminis-editor-defined-aliases.md` — the decision
  this one inverts; amended to note its alias direction is superseded here
- `docs/decisions/adr-092.md` — the checked-in baseline guard this
  decision's shim declarations and dropped `--slashmd-*` names are
  reconciled against (`pnpm docs:theming-baseline`)
- `docs/decisions/adr-087.md` — the consumption-side rename and
  `PREVIOUS_NAME`/fallback design this decision's `resolvesToPreviousName()`
  retirement supersedes for the definition side
- `src/styles.css` — the swapped shim/definition blocks; the migrated
  `@media print` block; the inline comment at `C4Component.tsx`'s
  `--color-*` sites
- `scripts/lib/theming-tokens.mjs` — `LEGACY_SHIM_TARGET`,
  `resolvesToShimTarget()`, the adjusted `PREVIOUS_NAME`
- `scripts/lib/theming-defined-tokens-baseline.json` — regenerated via
  `pnpm docs:theming-baseline` (61 `--slashmd-*` removed, 13
  previously-undeclared `--vscode-*` shims added)
- `README.md`, "Theming: CSS custom properties" — regenerated table and
  hand-rewritten prose describing the inverted mechanism
- [verveguy/zusammen#134](https://github.com/verveguy/zusammen/issues/134) —
  the downstream migration this decision unblocks
- [verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129) —
  the earlier, narrower migration ADR-93 unblocked

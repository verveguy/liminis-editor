# ADR-93: `--liminis-editor-*` Names Are Defined as Aliases of Their Legacy Names

**Date:** 2026-08-20
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #93 (verveguy/liminis-editor)

## Context

ADR-087 (#51) renamed every *consumption* site to `--liminis-editor-*`,
deliberately leaving every *definition* site (`:root`, `.dark`, the
`@media print` block) declaring the old, pre-`0.2.0` names. ADR-092 (#79)
built a checked-in baseline guarding those definitions, and explicitly
deferred a third item: whether the package should ever *define*
`--liminis-editor-*` names directly, with the legacy names kept as an
alias layer underneath.

That gap is not theoretical. Zusammen, a downstream host, reads this
package's definitions directly — `var(--vscode-background)`,
`var(--vscode-border)`, etc. — mapping its own design-system tokens onto
them rather than overriding them
([verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129)).
It wants to migrate those reads onto `--liminis-editor-*` instead, but
before this change there was nothing to migrate to: every row in the
README's token table read "Has a default: No (inline fallback only)."

**The naive fix is the trap ADR-087 already reasoned through once, now on
the definition side.** Adding `--liminis-editor-foreground: <default>;` to
the package's own `:root` unconditionally would resolve every one of the
250 consumption chains (`var(--liminis-editor-foreground, var(--vscode-foreground))`)
at the new name before ever reaching the old one — silently disabling the
ADR-087 fallback layer. A host like `liminis-app`, which supplies only
`--color-primary`/`--color-muted-foreground` (its own Tailwind `@theme`
tokens, coincidentally the fallback names `C4Component.tsx` already uses),
would stop tracking its own overrides with no error and no failing test —
exactly the failure mode ADR-092 exists to guard against.

Two further, non-obvious problems surfaced during implementation, not
anticipated by the plan:

1. **A definition-side alias's own `var()` reference is textually
   indistinguishable from a consumption site.** `scripts/lib/theming-tokens.mjs`'s
   `consumptionSitesIn()` scans raw text for depth-0 `var(--x` occurrences
   with no awareness of whether the enclosing statement is a custom-property
   *declaration* (`--liminis-editor-foreground: var(--vscode-foreground);`)
   or an ordinary property/JS-style value (`color: var(--liminis-editor-foreground, ...)`).
   Adding the alias block as originally planned would have made every one
   of the ~40 flat-aliased legacy names register as a newly "consumed"
   token, growing the README table and `TOKEN_DESCRIPTIONS` maintenance
   surface for tokens no host-facing code actually reads — a regression
   against this issue's own explicit Out of Scope ("does not add or remove
   rows" from the consumed/documented table).
2. **A CSS block comment containing a literal `*/` substring inside its
   text terminates early.** An early draft of the new `:root` block's
   header comment read `--vscode-*/--slashmd-*/--checkbox-*` — the `*/`
   embedded in `--vscode-*/--slashmd-*` closed the comment there, both for
   real CSS parsers and for this repo's own `stripCssComments()`, leaving
   the remainder of the intended comment as live (invalid) CSS text. This
   would have shipped a real authoring bug, not just a test artifact.

## Decision

**Legacy names keep carrying the real defaults. Each `--liminis-editor-*`
name becomes a new declaration that reads its legacy name via `var()`** —
`--liminis-editor-foreground: var(--vscode-foreground);` — added in a new
`:root`/`.dark` block placed immediately after the package's existing
`:root`/`.dark` blocks in `src/styles.css`. This is the direction the
spec's Background illustrated and Research confirmed by inspecting this
file's cascade structure directly: a CSS custom property resolves against
the *element's own* cascade at the point of use, not at declaration time,
so a single `:root`-level alias re-resolves correctly through `.dark`'s and
the `@media print` block's overrides of the *legacy* name it points to —
no per-block alias duplication is needed, and neither `.dark` nor the print
block needed to change for the ~40 tokens with a real existing declaration.

**All 59 renamed tokens (`PREVIOUS_NAME`'s full set) get a real declaration
in this pass, not only the two the originating issue named.** FR-001 says
"every token it currently consumes"; inspection of every consumption site
found 19 tokens with no existing `:root`/`.dark` legacy declaration to
alias to, not 2, split into three groups:

- **2 tokens** (`--vscode-input-bg`, `--vscode-foreground-muted`) resolve
  today through an existing *nested* fallback at their own consumption
  site. Their alias preserves that chain rather than flattening it:
  `--liminis-editor-input-bg: var(--vscode-input-bg, var(--vscode-code-bg));`.
- **13 tokens** have no CSS custom property backing anywhere — only a
  literal inline fallback at each consumption site (e.g.
  `var(--vscode-focus-border, #007acc)`). Their alias reproduces that
  literal as the alias's own fallback:
  `--liminis-editor-focus-border: var(--vscode-focus-border, #007acc);` —
  a host supplying nothing sees the same literal as before (FR-002); a
  host supplying the legacy name still wins (FR-003). 6 of these 13 vary by
  theme via a JS `isDark`/`dark` ternary at their consumption sites
  (`button-background`, all 5 `menu-*` tokens); those 6 get a matching
  `.dark` override in the new block, mirroring the same light/dark split
  their consumption sites already express in JS.
- **4 tokens** (`--color-primary`, `--color-primary-100`,
  `--color-muted-foreground`, `--color-muted-100`) are `liminis-app`'s own
  Tailwind `@theme` brand tokens, for which the package only ever supplied
  a literal final fallback, never asserted ownership. They are aliased
  identically to the 13 above — the mechanism doesn't newly assert
  ownership, it makes the existing fallback literal reachable under the new
  name too.

**Two of the 17 no-backing tokens have a real cross-site literal
inconsistency, discovered by direct inspection (one — `--vscode-errorForeground`
— was already flagged by Specify; the second — `--vscode-toolbar-hoverBackground`
— was not):**

| Token | Sites | Canonical value chosen |
|---|---|---|
| `--vscode-errorForeground` | `#f14c4c` (2 sites: `.editor-link-broken`, `:hover`) vs. `#f44336` (2 sites: `.block-delete-button:hover .block-delete-icon`, `.search-close-button:hover`) | `#f14c4c` — tie broken toward the more semantically central "broken link" indicator over two hover-only chrome details |
| `--vscode-toolbar-hoverBackground` | `rgba(128, 128, 128, 0.15)` (2 sites) vs. `rgba(128, 128, 128, 0.1)` (1 site, `.drag-handle:hover .drag-handle-icon`) | `rgba(128, 128, 128, 0.15)` — majority (2 of 3) |

Once a token has a single real definition, it necessarily wins over every
site's own inline fallback (fallback only applies when the property is
genuinely unset) — there is no mechanism that both defines the token
(FR-001) and preserves two different resolved values at different sites.
**This unifies 3 sites' rendered color to the canonical value, a small,
real, intentional visual change**, called out here per this repository's
convention of recording what a decision costs. The three affected call
sites (`src/styles.css:1148`, `:1188`, `:1704`) each carry a one-line
comment noting they are superseded by the new canonical default. The
spec's Out of Scope section explicitly permits this as a side effect of
choosing FR-001's value, not as a design goal in its own right.

**Consumption sites are left untouched.** All 224 `styles.css` sites and 26
`.tsx` sites keep their existing `var(--liminis-editor-x, var(--old-name-x, ...))`
chains. Simplifying them to a single `var(--liminis-editor-x)` call was
identified as optional cleanup (spec Assumptions) but would strip every
renamed token's `immediateFallback`, breaking `resolvesToPreviousName()`
(FR-011's existing drift guard) for all 59 tokens unless that guard were
also redesigned to check the *definition* site's alias target instead —
a materially larger, coordinated change deferred out of this issue's scope.
The now-redundant nested legacy fallback at each site is provably dead code
once its definition-side alias exists, left in place rather than removed.

**`scripts/lib/theming-tokens.mjs`'s `consumptionSitesIn()` gains a
declaration-value check.** A new helper,
`isCustomPropertyDeclarationValue(text, varStartIndex)`, walks back from a
depth-0 `var(` to the nearest statement boundary (`;`, `{`, or `}`) and
tests whether everything between that boundary and the `var(` is exactly
`--name:` — the shape only a custom-property declaration's value position
can have (an ordinary CSS property name never starts with `--`). Each
site now carries an `isDeclarationValue` flag; `consumedTokens()`'s Pass 1
skips depth-0 sites where it is true. This keeps the "consumed" inventory —
and therefore the README table's row set and the `TOKEN_DESCRIPTIONS`
maintenance surface — exactly as it was before this issue, satisfying its
Out of Scope constraint, while still letting `defaultedTokens()` (a
separate, unchanged function that just scans for any `--name:` declaration)
pick up all 59 new aliases as newly "defined."

**No other change to `theming-tokens.mjs` or its `.d.mts`.**
`isCustomPropertyDeclarationValue` is internal, not exported;
`defaultedTokens()` needed no change to recognize the new aliases; the
ADR-092 baseline guard, `resolvesWithoutHost()`, and `resolvesToPreviousName()`
all continue to operate over the same "consumed"/"defined" definitions they
already had, now simply seeing a larger defined set.

## Consequences

**Good:**

- A host can now read `--liminis-editor-x` directly and get a real value in
  every override state — the entire point of this issue and the
  prerequisite for zusammen#129's read migration (FR-001, SC-001, SC-006).
- A host supplying only a legacy name is unaffected: the alias's `var()`
  re-resolves through that name's own `.dark`/`@media print` overrides at
  the point of use, verified directly against this file's actual cascade
  structure rather than assumed from the general CSS-custom-property theory
  alone (FR-002, FR-003, User Story 2).
- The ADR-092 baseline guard now protects all 59 new alias declarations the
  same way it already protected the legacy ones — a future accidental
  deletion of an alias fails `pnpm test`, naming the token (FR-005, US4).
- The declaration-value fix to `consumptionSitesIn()` is general: it holds
  for any future alias declaration of this shape without further
  special-casing, not just the 59 added here.
- The premature-comment-close bug was caught by the same regenerated test
  suite that caught the consumption-site pollution, before either shipped —
  the CI guards this issue extends are what surfaced both problems.

**Bad / accepted:**

- Three consumption sites (`--vscode-errorForeground` at 2 sites,
  `--vscode-toolbar-hoverBackground` at 1 site) render a different,
  intentionally-unified color than before this change. A host relying on
  the specific pre-existing `#f44336`/`0.1`-alpha rendering at exactly
  those sites will see a small visual shift. This is an unavoidable
  consequence of giving these two tokens a single real definition (FR-001)
  when their own consumption sites already disagreed with each other —
  there is no mechanism that satisfies FR-001 without picking one value.
- The checked-in baseline grows from 41 to 100 entries in one change. Per
  ADR-092's own design the guard is one-directional (`missing` fails,
  `added` never does), so this is a mechanical `pnpm docs:theming-baseline`
  diff, not a CI risk — but it is a large diff for a human reviewer to
  read line-by-line.
- Every one of the 250 existing consumption sites keeps a nested legacy
  fallback that is now provably redundant dead code (the definition-side
  alias means the fallback branch can never be reached in practice). Removing
  it was explicitly deferred (see Decision) rather than done here, so this
  verbosity persists in `styles.css` and the five `.tsx` files until a
  future change picks it up.
- `consumptionSitesIn()`'s declaration-value detection is a text-boundary
  heuristic (nearest `;`/`{`/`}` before the `var(`), not a real CSS parser.
  It is correct for every declaration in this codebase today (all
  single-line), but a future multi-line custom-property declaration split
  across a statement boundary could evade it.

**Neutral:**

- The `@media print` block needed no changes: its `:root, .dark { ... }`
  selector already overrides every legacy name it touches, and each new
  alias's `var()` reference re-resolves through that override the same way
  it re-resolves through `.dark`'s.
- `liminis-app`'s own `--color-primary`/`--color-muted-foreground` overrides
  are unaffected either way — the 4 brand-token aliases only make their
  existing fallback literal reachable under the new name too, without
  changing what either name resolves to when the host supplies its usual
  overrides (SC-003).

## References

- Issue #93 (this decision); Issue #79 / ADR-092's "Not decided here" —
  this decision's direct origin (Item 3)
- `docs/decisions/adr-087.md` — the consumption-side rename and fallback
  design this decision extends to the definition side, and the trap
  ("that alternative is broken...") this decision's alias direction avoids
  repeating on the definition side
- `docs/decisions/adr-092.md` — the checked-in baseline guard this
  decision's new declarations are added to
- `src/styles.css` — the new `:root`/`.dark` alias block (after the
  existing `.dark` block); the three superseded-literal comments at the
  drag-handle-hover, block-delete-hover, and search-close-hover sites
- `scripts/lib/theming-tokens.mjs` — `isCustomPropertyDeclarationValue()`,
  `consumptionSitesIn()`'s new `isDeclarationValue` field, and
  `consumedTokens()`'s Pass 1 filter
- `scripts/lib/theming-defined-tokens-baseline.json` — regenerated via
  `pnpm docs:theming-baseline`, 41 → 100 entries
- `README.md`, "Theming: CSS custom properties" — regenerated table and
  hand-rewritten prose describing the alias mechanism
- [verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129)
  — the downstream migration this decision unblocks

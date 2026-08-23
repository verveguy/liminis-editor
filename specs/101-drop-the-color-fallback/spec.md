# Feature Specification: Drop the `--color-*` fallback from C4Component

**Feature Branch**: `fabrik/issue-101`
**Created**: 2026-08-22
**Status**: Specified
**Input**: User description: "Drop the `--color-*` arm from `C4Component.tsx`'s six consumption sites, so every internal site reads this package's own vocabulary and nothing else."

## Background

#98 inverted this package's token direction so that `--liminis-editor-*`
names carry real values directly, and added a contract test asserting that
no internal consumption site under `src/` reads a name outside this
package's own vocabulary — with **one deliberate, documented exception**,
`C4Component.tsx`'s six style expressions:

```ts
'var(--color-primary-100, var(--liminis-editor-primary-100))'
'var(--color-muted-100,   var(--liminis-editor-muted-100))'
'var(--color-primary,     var(--liminis-editor-primary))'
// …6 sites in total (2 properties × 3 expressions, one property repeated)
```

The intent, recorded in ADR-98, was that liminis-app's own Tailwind
`@theme` brand token should win for the C4 diagram layout-toggle buttons,
with this package's own `--liminis-editor-*` value as the fallback default.
ADR-98 itself calls this exception "the single highest-risk spot in this
change" and "a permanent asymmetry" — the one place a future contributor
could plausibly "clean up" into a silent regression against liminis-app,
with no CI guard that would catch a well-intentioned but wrong
simplification.

**Why it should go, measured on both apps' current `main`:**

| token | liminis-app | Zusammen |
|---|---|---|
| `--color-primary` | `var(--primary)` | not defined |
| `--liminis-editor-primary` | `var(--primary)` — **the same source** | not defined |
| `--color-primary-100` | **not defined** | not defined |
| `--color-muted-100` | **not defined** | not defined |

In liminis-app the two arms resolve identically, and for four of the six
sites the `--color-*` arm is dead in both known consumers. The fallback has
no observable effect anywhere it is deployed today.

It also costs a real, ongoing dependency: the package deliberately reads a
token from a host's Tailwind `@theme` namespace — a name this package never
defined and does not control. That coupling was accidental before #93; #98
made it intentional. If liminis-app renames or restructures its theme
tokens, C4 diagram colours change with no failing test in either
repository. And it is the single exception to the invariant #98 just
established and guarded — an invariant with one documented exception is
weaker than one without, because the exception is where the next reader
learns the rule is negotiable.

A host that wants to override the C4 diagram colours still can, by setting
`--liminis-editor-primary` (and the sibling tokens) — exactly what
liminis-app already does at `main.css:52`. The override path does not
depend on this fallback existing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uniform token vocabulary at every internal consumption site (Priority: P1)

As a maintainer of this package, I want every internal style expression
under `src/` — including `C4Component.tsx`'s six sites — to read this
package's own `--liminis-editor-*` vocabulary only, so the "no internal
site reads a name outside this package's own vocabulary" invariant holds
without a documented exception, and the package carries no dependency on a
host-specific Tailwind token it does not define or control.

**Why this priority**: This is the entire purpose of the issue. Without
it, the package keeps its one asymmetric, unguarded coupling to a name a
host's future refactor could silently break.

**Independent Test**: Run the theming contract test suite; it passes with
`--color-*` treated as forbidden everywhere under `src/`, with no
per-file exception.

**Acceptance Scenarios**:

1. **Given** `C4Component.tsx`'s six style expressions currently written as
   `var(--color-x, var(--liminis-editor-x))`, **When** this change is
   applied, **Then** each reads as a plain `var(--liminis-editor-x)`, with
   no reference to `--color-*` remaining anywhere in the file.
2. **Given** the theming contract test's legacy-property scan (which today
   forbids `--vscode-*`, `--slashmd-*`, and `--checkbox-*` under `src/` but
   deliberately excludes `--color-*` for this one exception), **When** this
   change is applied, **Then** the scan also forbids `--color-*`, and the
   suite passes with no exception carved out for `C4Component.tsx`.

---

### User Story 2 - No visible regression in liminis-app's C4 diagrams (Priority: P1)

As a maintainer of liminis-app, I want the C4 diagram layout-toggle
buttons to render with the same colours after this change as before it, so
that removing a fallback that was believed to be dead does not turn out to
be a silent, observable regression.

**Why this priority**: The issue's premise — "it changes no outcome" — is
a claim about current behaviour, not a guarantee. A wrong custom property
produces a silently dropped CSS declaration, not an error, so this must be
confirmed by looking at a running app, not inferred from reading the diff.

**Independent Test**: Run `liminis-app` (or an equivalent host) against
this package's built output, view a document containing a C4 diagram,
toggle its layout-edit button, and visually compare the active/inactive
button colours before and after this change, in both light and dark mode.

**Acceptance Scenarios**:

1. **Given** liminis-app's current setup (`--color-primary` and
   `--color-muted-foreground` set via its own Tailwind `@theme`, nothing
   else theming-related for these four tokens), **When** a document
   containing a C4 diagram is viewed before and after this change, **Then**
   the layout-toggle button's active/inactive background and icon/text
   colours are visually identical in both cases, in both light and dark
   mode.

---

### Edge Cases

- **`--liminis-editor-primary-100` and `--liminis-editor-muted-100` must
  resolve to a real, sensible value with no host configuration at all**,
  since after this change they are the only source for two of the four
  affected properties (the `--color-*` arm no longer supplies a fallback
  value, and the sites drop their own literal defaults too). Confirm what
  these two tokens (and their `-primary`/`-muted-foreground` counterparts)
  currently resolve to in `styles.css`'s `:root` and `.dark` blocks — do
  not assume a value exists or is reasonable without checking.
- **The README's generated theming token table currently documents
  `--color-primary`/`-100`/`-muted-foreground`/`-100` as the "consumed"
  name at these four token pairs** (per ADR-98: the token-extraction
  tooling treats the outermost name in a `var()` fallback chain as the
  documented-as-consumed name, and `--color-x` was outermost). Once these
  sites read `--liminis-editor-*` directly, that generated table changes
  which name it lists at these rows — the regenerated table, the
  hand-curated token descriptions behind it, and any prose in `README.md`
  and `src/styles.css` that explains the old `--color-*`-wins-first
  ordering all need to be brought back in sync with the new code.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `C4Component.tsx`'s six style expressions MUST be rewritten
  from `var(--color-x, var(--liminis-editor-x))` to a plain
  `var(--liminis-editor-x)`, for both affected property pairs
  (`--liminis-editor-primary`/`--liminis-editor-primary-100` and
  `--liminis-editor-muted-foreground`/`--liminis-editor-muted-100`).
- **FR-002**: `--liminis-editor-primary`, `--liminis-editor-primary-100`,
  `--liminis-editor-muted-foreground`, and `--liminis-editor-muted-100`
  MUST each resolve to a real, non-empty, sensible value with no host
  configuration, in both light and dark mode, since they become the sole
  source for the C4 diagram layout-toggle buttons' colours.
- **FR-003**: The theming contract test's legacy-property scan MUST be
  extended so that `--color-*` is forbidden anywhere under `src/`, on the
  same footing as `--vscode-*`, `--slashmd-*`, and `--checkbox-*` — closing
  the exception #98 carved out specifically for this file, so the "no
  internal consumption site reads a name outside this package's own
  vocabulary" invariant holds with no per-file exception.
- **FR-004**: Documentation that is generated from, or describes, the
  consumption-site fallback chain at these four token pairs — the
  README's generated theming token table, the hand-curated token
  descriptions behind it, and the explanatory comments in
  `C4Component.tsx` and `src/styles.css` — MUST be brought back in sync
  with the new plain `var(--liminis-editor-x)` expressions.
- **FR-005**: ADR-98 MUST be amended — by appending a dated amendment
  block, not by rewriting its original text — to record that the
  `C4Component.tsx` exception has been removed and why, per this
  repository's amendment convention (see `adr-077.md`/`adr-078.md` for the
  pattern).
- **FR-006**: The e2e test at
  `examples/electron/e2e/theming-aliases.spec.ts` that currently asserts
  the exception's behaviour (a `--color-*` override wins over
  `--liminis-editor-*` at a probe reproducing `C4Component.tsx`'s
  expression) MUST be retargeted to assert the new behaviour — a
  `--color-*` override no longer has any effect on that expression, and
  only `--liminis-editor-*` themes it — rather than being deleted outright.
- **FR-007**: C4 diagrams MUST render with the same colours in liminis-app
  after this change as before it, verified by visual inspection in a
  running app, not inferred from reading the CSS — a wrong custom property
  reference silently drops the declaration rather than producing an error.
- **FR-008**: `CHANGELOG.md`'s `## Unreleased` section MUST record this
  change, consistent with this repository's established convention of
  documenting theming-contract changes there (see the existing `#98`
  entry it sits alongside).

### Key Entities

- **Consumption site**: one of `C4Component.tsx`'s six `var(...)`
  expressions that currently reads `--color-*` first with a
  `--liminis-editor-*` fallback; after this change, each reads
  `--liminis-editor-*` only.
- **Legacy/foreign-property scan**: the theming contract test's check that
  no internal consumption site under `src/` reads a name outside this
  package's own `--liminis-editor-*` vocabulary; today it exempts
  `--color-*` for this file only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of `var(--color-` remain anywhere under
  `src/` (six today, all in `C4Component.tsx`).
- **SC-002**: The theming contract test suite passes with `--color-*`
  forbidden under `src/` on the same footing as every other legacy/foreign
  prefix, with no file-specific exception in the test or its supporting
  tooling.
- **SC-003**: C4 diagram colours in liminis-app are confirmed visually
  unchanged, in both light and dark mode, by a human or an automated
  visual check against a running app.
- **SC-004**: ADR-98 contains a dated amendment describing the removal of
  the `C4Component.tsx` exception and the reasoning behind it; its
  original decision text is unmodified.
- **SC-005**: The e2e test previously pinning the exception's behaviour now
  pins the opposite behaviour (a `--color-*` override has no effect; only
  `--liminis-editor-*` themes the buttons) and passes.

## Assumptions

- The `--color-primary`/`--color-muted-foreground`/their `-100` variants
  are not part of this package's legacy (`--vscode-*`/`--slashmd-*`/
  `--checkbox-*`) shim vocabulary and have no `:root`/`.dark` declaration
  of their own anywhere in this package — they are purely a host's
  Tailwind `@theme` names read (never defined) by the six sites this issue
  changes. Removing the read sites removes the dependency entirely; there
  is no corresponding shim declaration elsewhere to clean up.
- Whether to add a dedicated C4 diagram fixture under `examples/electron`
  (which has none today, which is why #98's e2e coverage of this exception
  used a detached probe element rather than a rendered diagram) is left as
  an implementation decision for the Plan stage, weighed against
  retargeting the existing detached-element probe test in place (FR-006).
  Either approach satisfies FR-006/SC-005; a real fixture would also make
  FR-007's visual verification reproducible in CI, which the current setup
  does not support.
- This change is scoped to `C4Component.tsx`'s six consumption sites and
  the documentation/tests that describe them. It does not touch any other
  file's consumption sites, which already read `--liminis-editor-*` only.

## Out of Scope

- Removing or renaming any `--liminis-editor-*` declaration, or any
  `--vscode-*`/`--slashmd-*`/`--checkbox-*` legacy shim — this issue only
  removes a *read* of a name the package never defined.
- Changing which value `--liminis-editor-primary`/`-100`/
  `-muted-foreground`/`-100` resolve to. #98 (FR-008 of that issue) already
  made these package-owned, brand-derived defaults; this issue only stops a
  separate token from overriding them at these six sites.
- Any change to how `liminis-app` or Zusammen theme this package. A host
  that wants to override the C4 diagram colours continues to do so via
  `--liminis-editor-primary` and its siblings, unchanged by this issue.

## Source References

- `src/app/editor/nodes/C4Component.tsx` — the six consumption sites.
- `tests/theming-contract.test.ts` and `scripts/lib/theming-tokens.mjs` —
  the legacy-property scan and its `TOKEN_DESCRIPTIONS`/README-generation
  tooling.
- `examples/electron/e2e/theming-aliases.spec.ts` — the e2e test covering
  the exception's current behaviour.
- `docs/decisions/adr-98-invert-token-direction.md` — the ADR documenting
  why the exception was introduced, to be amended by this issue.
- `src/styles.css` — the `:root`/`.dark` declarations for
  `--liminis-editor-primary`/`-100`/`-muted-foreground`/`-100`, and the
  explanatory comment describing the exception this issue removes.
- This spec's "what exists today" claims were verified directly against
  `origin/main` (which includes PR #99/#98's merge) rather than assumed —
  worth noting because this worktree's own branch base predates that
  merge, so `C4Component.tsx` as checked out locally at Specify time still
  showed #93-era code, not the #98-era code this spec (and the original
  issue) describes. Whichever stage does the implementation work should
  confirm it is operating against a branch that includes PR #99 before
  editing `C4Component.tsx`, rather than trusting the file it finds
  on disk.

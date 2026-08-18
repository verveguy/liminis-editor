# Feature Specification: Drop the Tailwind Requirement — Fold Utility Classes into styles.css

**Feature Branch**: `fabrik/issue-49`
**Created**: 2026-08-18
**Status**: Specified
**Input**: User description: "Drop the Tailwind requirement: fold nine utility classes into the shipped styles.css"

## Background

`@liminis/editor`'s real styling system is semantic CSS plus custom properties —
2,477 lines, 358 selectors, 60 `--vscode-*` variables in `src/styles.css`. A
handful of Tailwind utility classes sit outside that system, on the editor's
root wrapper and on `App.tsx`'s loading/error states. Because these classes
resolve at build time against *whatever Tailwind config the host has* (or
against none), the package currently asks every consumer to run Tailwind v4,
add an `@source` line pointing into `node_modules`, cope with pnpm's `.pnpm/`
paths, and then manually verify a utility class actually appears in the
generated CSS — because, in the README's own words, the failure is "silent,
not an error." An adopter not using Tailwind gets no warning and a mislaid
editor.

Measured in liminis-app (see verveguy/liminis#1016), the `@source` directive
contributes exactly two classes to the generated stylesheet: `.ml-5` (real —
the editor's left margin) and `.list-item` (an inert false positive from
Tailwind's scanner matching the substring in
`data-list-item-paragraph-break`). So today's cost is a build-time framework
requirement, a documented footgun, and a silent failure mode — for one margin.

Folding the remaining utilities into `styles.css` makes the package's styling
contract exactly one thing — *import `styles.css`* — which consumers must
already do. Tailwind as a hard peer requirement was explicitly considered and
rejected: Tailwind resolves at build time, CSS variables at runtime, so
adopting it would replace a working runtime theming API with a compile-time
one and force every adopter to rebuild in order to retheme. It would also
mandate Tailwind v4 for a package that was just made public. See #50 for what
themeability actually needs here.

**Correction to the original issue's inventory.** The issue as filed named two
elements — `App.tsx:266` (loading state, 5 utility classes) and
`Editor.tsx:812` (root wrapper, 4 utility classes) — as "the whole coupling."
A repo scan for this spec found a third, unlisted location carrying Tailwind
utilities: `App.tsx:276`, the error banner (`fixed top-0 left-0 right-0 px-4
py-2 bg-red-500 text-white text-center z-[1000]`, 10 classes). This is not a
new requirement — the issue's own acceptance criterion ("No Tailwind utility
class remains in any `className` in `src/`") already covers it — but the
scope section undercounted the work. This spec folds the error banner into
scope explicitly so the gap doesn't surface only at review time.

`src/styles.css:142-145` also carries a now-inaccurate comment on
`.editor-inner` — `/* Layout handled by Tailwind - this class exists for CSS
hover rules */` — that documents the very coupling this issue removes and
should be corrected alongside the fix.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Editor renders correctly with zero Tailwind in the host (Priority: P1)

An adopter integrates `@liminis/editor` into an app that has no Tailwind
installed and no Tailwind config. They import `styles.css` as the README
already requires, render the editor (including its loading and error states),
and see correct layout with no additional setup step and no silent gaps.

**Why this priority**: This is the entire problem the issue exists to fix —
today this scenario produces a mislaid editor with no warning.

**Independent Test**: In a consumer project with no Tailwind dependency or
config, import and render the loading state, the error state, and the
editor body; compare visually against the current (Tailwind-dependent)
rendering.

**Acceptance Scenarios**:

1. **Given** a consumer app with no Tailwind installed, **When** the editor is
   in its loading state (`content === null`), **Then** the spinner and
   "Loading document..." text are centered together with the same gap, fill
   the viewport height, and use the same dimmed foreground color as today.
2. **Given** a consumer app with no Tailwind installed, **When** the editor
   reports an error, **Then** the error banner spans the full width fixed to
   the top of the viewport, with the same red background, white centered
   text, and stacking order (`z-index`) as today.
3. **Given** a consumer app with no Tailwind installed, **When** the editor
   body renders, **Then** the content column has the same 800px max width and
   the same left/right margin and padding as today.

---

### User Story 2 - README no longer instructs adopters to configure Tailwind (Priority: P2)

A new adopter reads the README's Styling section to learn what's required to
render the editor correctly. They see a single instruction — import
`styles.css` — with no conditional Tailwind branch, no `@source` directive,
and no instruction to manually verify generated output.

**Why this priority**: Removing the code coupling without removing the
now-inapplicable documentation leaves a confusing, misleading footgun in
place; both are part of "drop the Tailwind requirement."

**Independent Test**: Read `README.md`'s Styling section end to end; confirm
no mention of Tailwind, `@source`, or verifying generated utility classes
remains.

**Acceptance Scenarios**:

1. **Given** `README.md`, **When** reading the Styling section, **Then** the
   "If you use Tailwind" subsection is absent and no other section asks the
   reader to configure Tailwind.

---

### Edge Cases

- The error banner (`App.tsx:276`) was not named in the original issue's
  three-element inventory but carries Tailwind utility classes and must be
  included — see Background correction above.
- A host that previously relied on its own Tailwind config's spacing scale to
  resolve `ml-5` / `max-w-[800px]` to non-default values will see those values
  frozen to fixed CSS after this change. This is an intended, documented
  behavior change (layout constants were never meant to be host-tunable), not
  a regression — it is the reason this ships as a minor version, not a patch.
- The `.editor-inner` CSS rule's comment referencing Tailwind becomes
  inaccurate once layout is defined in CSS and must be corrected, not just
  left stale.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The loading-state markup at `App.tsx:266` MUST use a semantic
  class name (no Tailwind utility tokens) styled in `styles.css`, preserving
  its current centered, gapped, full-height, dimmed-foreground appearance.
- **FR-002**: The error-banner markup at `App.tsx:276` MUST use a semantic
  class name (no Tailwind utility tokens) styled in `styles.css`, preserving
  its current fixed, full-width, top-anchored, red-background,
  white-centered-text, stacked-above-content appearance.
- **FR-003**: The editor root wrapper at `Editor.tsx:812` MUST use a semantic
  class name (no Tailwind utility tokens) styled in `styles.css`, preserving
  its current relative positioning, 800px max width, and left/right
  margin/padding.
- **FR-004**: The stale Tailwind-attributing comment on `.editor-inner` in
  `src/styles.css` MUST be corrected to reflect that layout is now defined in
  CSS, not delegated to a build-time utility framework.
- **FR-005**: No `className` anywhere under `src/` may contain a Tailwind
  utility token (spacing/sizing scale, flex/grid utilities, arbitrary-value
  bracket syntax, color-scale utilities, positioning utilities, etc.) after
  this change.
- **FR-006**: The "If you use Tailwind" section MUST be removed from
  `README.md`, along with any other README text instructing adopters to
  configure Tailwind or verify generated utility output.
- **FR-007**: `package.json`'s `version` field MUST be bumped from `0.1.1` to
  `0.2.0`, reflecting the behavior change described in the Edge Cases section.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Searching `src/` for Tailwind utility patterns in `className`
  attributes (spacing/sizing scale classes, flex/grid utilities, arbitrary
  bracket values, color-scale utilities) returns zero matches.
- **SC-002**: A consumer app built with no Tailwind dependency or config
  renders the editor's loading state, error state, and body with the same
  visual layout as before this change — verified by looking, since this
  failure mode is silent rather than a build error.
- **SC-003**: `README.md` contains no instruction to install, configure, or
  verify output for Tailwind.
- **SC-004**: `package.json` reports version `0.2.0`.

## Assumptions

- Consumer-side follow-ups named in the original issue — removing the
  `@source` line from liminis-app's `src/renderer/styles/main.css`, and from
  Zusammen if it has one — live in those repositories, not this one. This
  spec's PR covers only `verveguy/liminis-editor`; the consumer cleanups are
  tracked as separate follow-up work in their own repos.
- The exact colors/spacing chosen for the new semantic CSS rules should
  reproduce the values Tailwind's default theme currently resolves the
  existing utilities to (e.g. `bg-red-500`, the default 4px spacing scale),
  since that is what ships today. Picking the precise CSS values is a
  Research/Plan-stage concern, not a spec-level requirement.
- `docs/decisions/adr-075.md` and `docs/decisions/adr-078.md` document the
  Tailwind `@source` requirement as an accepted architectural decision this
  issue reverses. Whether that warrants a new/amending ADR entry is left to
  the Plan stage; it is not a blocking requirement of this spec.

## Out of Scope

- Changes to the liminis-app or Zusammen repositories (tracked separately).
- Adopting Tailwind as a peer dependency to gain theming — explicitly
  considered and rejected in favor of the existing runtime CSS-variable API
  (see #50).
- ~~Authoring or amending ADRs~~ — flagged in Assumptions as a Plan-stage
  decision, not a spec-level requirement. Plan determined it was warranted:
  `docs/decisions/adr-086.md` documents this reversal, amending ADR-075 and
  ADR-078.

## Source References

- `src/app/App.tsx:266` — loading state
- `src/app/App.tsx:276` — error banner (not in original issue inventory; see
  Background correction)
- `src/app/editor/Editor.tsx:812-813` — editor root wrapper (`:813` is
  already the intended semantic pattern)
- `src/styles.css:142-145` — `.editor-inner` rule with stale Tailwind comment
- `README.md:197-215` — "If you use Tailwind" section
- `docs/decisions/adr-075.md`, `docs/decisions/adr-078.md` — document the
  Tailwind requirement being reversed
- `package.json` — `version` field, currently `0.1.1`
- verveguy/liminis#1016 — measurement of the `@source` directive's actual
  contribution in liminis-app
- #50 — theming follow-up referenced by the original issue

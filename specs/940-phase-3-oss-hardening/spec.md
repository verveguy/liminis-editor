# Feature Specification: Phase 3 — OSS hardening for `@liminis/editor`

**Feature Branch**: `fabrik/issue-940`
**Created**: 2026-08-05
**Status**: Draft
**Input**: User description: "Phase 3 — OSS hardening for `@liminis/editor`: standalone build, peerDeps, wiki-link patch, license/docs/demo"

## Background

This is Phase 3 of the editor extraction described in #938. Phases 1 (#938, carve the package)
and 2 (#939, unified annotation mechanism) delivered a workspace-internal `@liminis/editor`.
**This issue makes the package genuinely consumable outside the Liminis monorepo**, so it can be
open-sourced and adopted by Zusammen (and others) as a real dependency rather than a workspace path.

After Phases 1–2, `@liminis/editor` is consumed in-workspace the way `@liminis/shared-types` is —
`main`/`types` point at raw TypeScript source, and it relies on monorepo-level machinery. That is
enough for `liminis-app`, but it is not a publishable artifact:

- **No build step.** No ESM output, no `.d.ts` declarations. An external consumer would have to
  compile the package's TypeScript itself.
- **No peer dependencies.** `react`, `react-dom`, and `lexical` are plain `dependencies`
  (`packages/editor/package.json`), so an external consumer risks duplicate React/Lexical instances,
  which breaks hooks and Lexical's editor context. This is benign today only because everything in
  the workspace realpaths to a single `react@19.2.5`; on any version drift it becomes two React
  copies and an "Invalid hook call" crash rather than graceful degradation.
- **A monorepo-only dependency patch.** The package depends on `mdast-util-wiki-link@0.1.2` **as
  patched by the workspace's `pnpm` `patchedDependencies` entry** (`pnpm-workspace.yaml` →
  `liminis-app/patches/mdast-util-wiki-link@0.1.2.patch`). Outside this repo that patch does not
  apply, so wiki-link behaviour silently differs or breaks.
- **Nothing for an evaluator.** No license, no consumer-facing documentation, and no way for a
  prospective adopter to see the editor working before wiring it into their app. The repository has
  no root `LICENSE` file, and `liminis-app` declares `"license": "UNLICENSED"`.

### Carried-forward context from Phases 1 and 2

Three facts recorded on the issue before this stage ran, each verified against the repository, bear
directly on the requirements below.

**1. `sideEffects` is a known landmine, and this issue is where it gets re-decided.**
The obvious lever for proving an annotations-disabled consumer carries no annotation code is
`"sideEffects": false`. ADR-075 §4 prohibits it outright, and that prohibition is a reproduction,
not caution: during #938's Validate, declaring `sideEffects` crashed the renderer with
`ReferenceError: Prism is not defined` — 138 e2e failures, blank window. The mechanism is that
declaring our package side-effect-free changes rolldown's *whole-graph* chunking, which separated
`prismjs`'s core (reached transitively via `@lexical/code`) from `prism-clike.js`, which mutates a
bare `Prism` global that was by then undefined. The side effect lives in a **transitive dependency**,
so our own `sideEffects` field cannot express it; `["**/*.css"]` and `false` fail identically. The
prohibition is guarded by a test (`liminis-app/src/shared/__tests__/editor-package-wiring.test.ts`,
"does not declare sideEffects on @liminis/editor").

The measurement this issue needs does not depend on that field. #939 achieved the same goal
structurally, via a `React.lazy()` boundary on `AnnotationSurface` (`packages/editor/src/app/editor/Editor.tsx`).
Measured on a running build during #939's Validate: `AnnotationSurface` is a single **49,164 B**
chunk loaded only when a host configures a kind, and windows hosting no editor (`graph`, `workflow`,
`discussion`) gained **+417 bytes** total against `main`. That lazy boundary is what the measurement
should be pointed at.

What genuinely remains open is that ADR-075's prohibition was established for the package as
consumed *as raw TypeScript through `liminis-app`'s bundler*. A build (FR-001) gives an external
consumer a different module graph, and ADR-075 itself defers the question ("Revisit under #940, when
the package gains a real build and per-entry chunk control"). This is a technical decision for
Research/Plan, gated below rather than left implicit.

**2. Two `liminis-app` build guards exist *only* because the package is raw TypeScript.**
Both are asserted by `editor-package-wiring.test.ts`:

- `liminis-app/electron.vite.config.ts` — `externalizeDepsPlugin({ exclude: ['@liminis/editor'] })`
  for `main` and `preload`, because raw-TS workspace packages must be bundled rather than externalized.
- `liminis-app/src/renderer/styles/main.css` — `@source "../../../../packages/editor/src"`, because
  Tailwind v4's auto source detection skips `node_modules`; without it the editor's classes are
  silently absent.

If `liminis-app` switches to consuming built output (FR-008 leaves that open), **both become wrong at
the same time**, and because the guards assert their presence they must change in lockstep or CI will
enforce the stale state. The Tailwind guard is the dangerous half: its failure mode is silent,
unstyled output rather than an error.

**3. The subpath count is six, and each must resolve from built output.**
As of #939 the `exports` map has `.`, `./markdown`, `./headless`, `./contract`, `./annotations`, and
`./styles.css`, each with a reason recorded in ADR-075's inventory. Two are load-bearing in ways a
naive build config will break:

- `./contract` exists so the Electron **preload** can `import type` the message shapes without
  pulling zod or renderer code into that boundary.
- `./markdown` exists because `./headless` re-exports `mathjax-config`, whose ~90 bare
  `import '@mathjax/src/js/input/tex/…Configuration.js'` lines are genuinely side-effectful and
  unshakeable (~1.9 MB). A build that collapses these two, or that emits a single flat entry,
  silently reintroduces that weight.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An external consumer installs and uses the package (Priority: P1)

A developer with no access to the Liminis monorepo adds `@liminis/editor` to a React app, imports
`<Editor>` and the markdown pipeline from the public entries, and gets working types — without
compiling the package's TypeScript themselves and without any monorepo-specific build configuration.

**Why this priority**: This is the whole point of the issue. Without it the package is a workspace
path, not a dependency, and neither Zusammen nor any external adopter can use it.

**Independent Test**: Pack the package and install the tarball into a minimal React app outside the
workspace; build and type-check that app against the built artifact.

**Acceptance Scenarios**:

1. **Given** a packed tarball of `@liminis/editor`, **When** a minimal external React app installs it
   and imports `<Editor>` and the markdown pipeline, **Then** the app builds and type-checks with all
   public types resolving from the emitted `.d.ts` declarations, not from `.ts` source.
2. **Given** the same external app, **When** it imports each of the six public subpaths
   (`.`, `./markdown`, `./headless`, `./contract`, `./annotations`, `./styles.css`), **Then** each
   resolves to built output and type-checks.
3. **Given** an external app importing only `@liminis/editor/markdown`, **When** it builds, **Then**
   the MathJax configuration weight reachable through `./headless` is not pulled in.
4. **Given** an external app's Electron-preload-style boundary importing only from
   `@liminis/editor/contract` with `import type`, **When** it builds, **Then** no zod and no renderer
   code enters that boundary.

---

### User Story 2 - Wiki links work without the monorepo patch (Priority: P1)

Wiki-link parsing and serialization behave identically for an external consumer as they do inside the
monorepo, with no `pnpm patch` requirement. The patch currently in force adds a single behaviour:
when a wiki-link has an alias and its target ends with a backslash (the escaped-pipe case inside
markdown tables), the trailing backslash is stripped from the target.

**Why this priority**: Without this, an external consumer silently gets different — and wrong —
round-trip behaviour for wiki links inside tables. Silence is what makes it P1.

**Independent Test**: Run the existing wiki-link round-trip fixtures against a package installation
that has had no `pnpm` patch applied.

**Acceptance Scenarios**:

1. **Given** the package installed outside the workspace with no patch machinery available,
   **When** wiki-link round-trip fixtures run, **Then** they pass identically to in-workspace runs,
   including the aliased-wiki-link-in-table case the patch exists for.
2. **Given** the resolution has landed, **When** the workspace's `patchedDependencies` entry is
   inspected, **Then** it has either been removed or is explicitly documented as redundant.

---

### User Story 3 - A bare-editor consumer pays no annotation cost (Priority: P2)

A consumer that configures no annotation kinds gets a bundle containing no annotation UI and no
annotation-specific weight — demonstrated by measurement, not asserted.

**Why this priority**: The unified annotation mechanism from #939 is a selling point only if opting
out is genuinely free. It is already believed true via the `React.lazy()` boundary; this story makes
it a checked fact rather than a belief.

**Independent Test**: Build two consumers — one with zero annotation kinds configured, one with at
least one — and compare their emitted chunks.

**Acceptance Scenarios**:

1. **Given** a consumer configuring no annotation kinds, **When** it is built and its output
   inspected, **Then** no `AnnotationSurface` chunk and no annotation-specific module is present in
   any chunk it loads.
2. **Given** a consumer configuring at least one annotation kind, **When** it is built, **Then** the
   annotation code is present, confirming the measurement distinguishes the two cases.

---

### User Story 4 - A prospective adopter can evaluate the package (Priority: P2)

Someone considering the package can read what it does, see its API, and run it, without reading its
source or cloning the Liminis monorepo.

**Why this priority**: Necessary for open-sourcing to mean anything, but it gates adoption rather
than correctness.

**Independent Test**: From the package directory alone (or its tarball plus a demo), follow the
documentation to a running editor.

**Acceptance Scenarios**:

1. **Given** the packaged artifact, **When** its contents are inspected, **Then** it includes a
   license file and consumer-facing documentation covering the `<Editor>` API, the markdown pipeline
   (`parseMarkdown` / `stringifyMarkdown` / mappers), and the annotation mechanism.
2. **Given** the repository, **When** the demo is started per its documented instructions, **Then** a
   working editor renders and at least one annotation kind can be exercised interactively.
3. **Given** the demo, **When** its imports are inspected, **Then** it consumes only the package's
   public entry points — it does not reach into internal source paths.

---

### Edge Cases

- A consumer on a different but peer-range-compatible React or Lexical patch version → works, with a
  single React and a single Lexical instance.
- A consumer using a bundler other than `liminis-app`'s (Vite / webpack / rollup) → the ESM output
  and `exports` map resolve correctly.
- `styles.css` is importable by an external consumer without monorepo-specific build configuration.
  Note that Tailwind class *generation* for the editor's markup is a separate concern from importing
  the stylesheet; documentation must tell an external Tailwind consumer what they need to do, since
  the monorepo's `@source` directive is not available to them.
- The demo must not become a hidden second consumer that drifts from the public API.
- A consumer importing `./markdown` alone must not transitively acquire `./headless`'s MathJax weight.
- If `liminis-app` switches to consuming built output, its two raw-TS-only guards
  (`externalizeDepsPlugin` exclusion, Tailwind `@source`) and the wiring tests that assert them must
  change together; the Tailwind case fails silently, not loudly.
- A published-shape consumer whose module graph differs from `liminis-app`'s may tree-shake
  differently than the in-workspace build — any `sideEffects` conclusion must be re-tested against
  the Prism path specifically, not reasoned about.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package MUST have a real build producing ESM output plus `.d.ts` type declarations,
  with `package.json` `exports` / `types` pointing at the built artifact for external consumers.
- **FR-002**: All six existing public subpaths — `.`, `./markdown`, `./headless`, `./contract`,
  `./annotations`, `./styles.css` — MUST continue to exist and MUST resolve to built output, each
  preserving the isolation reason recorded in ADR-075: in particular `./markdown` MUST NOT
  transitively pull `./headless`'s MathJax configuration weight, and `./contract` MUST remain
  importable as types only, free of zod and renderer code.
- **FR-003**: `react`, `react-dom`, and `lexical` MUST be declared as `peerDependencies` (aligned
  with the React 19 / Lexical 0.44 versions both apps already use) rather than bundled or
  hard-depended, so a consumer resolves exactly one React and one Lexical instance.
- **FR-004**: The patched `mdast-util-wiki-link@0.1.2` dependency MUST be resolved so the package is
  self-contained outside this monorepo — upstreamed, vendored into the package, or replaced. The
  workspace's `patchedDependencies` entry MUST then be removed or documented as redundant.
- **FR-005**: Wiki-link parse and serialize behaviour MUST be unchanged by FR-004, including the
  aliased-target-with-trailing-backslash case the patch exists for. Existing wiki-link round-trip
  fixtures MUST pass.
- **FR-006**: Tree-shakeability of the annotation mechanism MUST be verified with an actual bundle
  measurement against the `React.lazy()` boundary on `AnnotationSurface`, not assumed.
- **FR-007**: The package MUST include a license file and consumer-facing documentation covering the
  `<Editor>` API, the markdown pipeline, the annotation mechanism, and what an external Tailwind
  consumer must do to get the editor's classes generated.
- **FR-008**: A runnable demo MUST exist that exercises the editor and at least one annotation kind,
  importing only the package's public entry points.
- **FR-009**: CI MUST build the package and type-check an external-style consumer against the built
  output, so publishability cannot silently regress.
- **FR-010**: `liminis-app` MUST continue to build, test, and behave identically throughout. Whether
  it consumes source or built output is an implementation decision for Plan; if it switches to built
  output, the two raw-TS-only guards in `electron.vite.config.ts` and `renderer/styles/main.css`
  MUST be updated together with the wiring tests that assert them, and no silent loss of editor
  styling may result.
- **FR-011**: The ADR-075 §4 prohibition on declaring `"sideEffects"` MUST hold by default. It MAY be
  narrowed to apply only to source consumption **if and only if** (a) the `Prism is not defined`
  failure path is re-tested against a real build rather than reasoned about, (b) `liminis-app`'s e2e
  suite is green under the change, and (c) ADR-075 is amended to scope the prohibition and the
  guarding test in `editor-package-wiring.test.ts` is updated to match. Absent all three, the field
  MUST NOT appear. FR-006's measurement MUST NOT depend on this field either way.

### Key Entities

- **Built artifact**: the emitted ESM + `.d.ts` output that external consumers resolve through the
  `exports` map, as distinct from the `src/` TypeScript the workspace currently consumes.
- **External-style consumer**: a minimal React app, outside the workspace, that installs the packed
  package and type-checks and builds against its declarations — the CI proxy for a real adopter.
- **Demo**: a runnable application exercising the editor and at least one annotation kind through
  public entry points only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm pack` (or equivalent) produces a tarball that an external React app can install
  and use, with all public types resolving from the built declarations.
- **SC-002**: All six subpaths resolve from the built artifact in that external app, and a
  `./markdown`-only consumer's build contains no MathJax configuration weight.
- **SC-003**: No wiki-link behaviour depends on a monorepo `pnpm` patch; wiki-link round-trip
  fixtures pass with no patch applied.
- **SC-004**: A measured bundle for an annotations-disabled consumer contains no annotation code,
  while the same measurement on an annotations-enabled consumer does contain it.
- **SC-005**: CI fails if the package stops building or its public types stop resolving.
- **SC-006**: The packaged artifact contains a license file and consumer-facing documentation, and
  the demo runs from documented instructions.
- **SC-007**: `liminis-app`'s full pre-commit suite (`typecheck`, `lint`, `build`, `test`) passes,
  and its e2e suite is green — the latter specifically because the `sideEffects` and Tailwind
  failure modes are invisible to the former.

## Assumptions

- The package's public API surface is settled by #938 and #939; this issue changes how it is
  *delivered*, not what it contains.
- **License choice**: absent direction otherwise, a permissive OSI license (MIT) is assumed, matching
  the ecosystem the package sits in (Lexical, the mdast/micromark stack, and React are all MIT). The
  repository has no root `LICENSE` today and `liminis-app` is `UNLICENSED`, so this is a new
  declaration for the package alone and does not license the rest of the repository. The owner may
  override this choice at any point before the change lands; because publishing is out of scope, the
  declaration is reversible here.
- "External-style consumer" in CI means a fixture app inside this repository that consumes the packed
  tarball rather than a workspace path — not a separate repository.
- The demo may live in this repository; FR-008's public-entry-points-only constraint is what keeps it
  from drifting into a privileged second consumer.
- Peer ranges track the versions both apps already use (React 19, Lexical 0.44); widening them to
  older majors is not required.

## Out of Scope

- Actually publishing to a public registry. This issue proves publishability; the publish decision
  and any registry, versioning, or release automation are separate.
- Zusammen's adoption of the package and deletion of its editor copy (follow-up in the Zusammen repo).
- Any change to editor, correction, or comment *product* behaviour.
- Licensing the rest of the Liminis repository.
- Changes to the public API surface established by #938 and #939.

## Source References

- `packages/editor/package.json` — current `exports` map, `dependencies` including `react`/`react-dom`/`lexical`
- `pnpm-workspace.yaml` — `patchedDependencies` entry for `mdast-util-wiki-link@0.1.2`
- `liminis-app/patches/mdast-util-wiki-link@0.1.2.patch` — the trailing-backslash fix, applied to both `src/from-markdown.ts` and `dist/index.js`
- `liminis-app/src/shared/__tests__/editor-package-wiring.test.ts` — guards for the Tailwind `@source` directive, the `externalizeDepsPlugin` exclusion, the `./markdown` routing, and the `sideEffects` prohibition
- `liminis-app/electron.vite.config.ts` — `externalizeDepsPlugin({ exclude: ['@liminis/editor'] })`
- `liminis-app/src/renderer/styles/main.css` — `@source "../../../../packages/editor/src"`
- `packages/editor/src/app/editor/Editor.tsx:105` — the `React.lazy()` boundary on `AnnotationSurface`
- `docs/project_notes/decisions/adr-075.md` §4 — the `sideEffects` prohibition and its deferral to this issue
- Prior phases: #938 (carve the package), #939 (unified annotation mechanism)

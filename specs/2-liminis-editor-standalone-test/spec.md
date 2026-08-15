# Feature Specification: Standalone Test Shells for `@liminis/editor` — an Electron Host and a Feature-Complete Web Shell

**Feature Branch**: `fabrik/issue-2`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "`@liminis/editor` has no standalone host you can run to exercise it. Testing the package's real behaviour currently means running `liminis-app` — a full Electron application — to check a library."

## Background

`@liminis/editor` has no standalone host it can be exercised through. Verifying the package's real behavior currently means running `liminis-app`, a full Electron application, just to check a library.

**What exists today:**

- **`examples/demo`** — a Vite/React web app (`index.html`, `dev`/`build`/`preview`, a 7 KB `App.jsx`) that renders the editor with one configured annotation kind, importing from `.`, `./annotations` and `./markdown`. A real browser shell, but it demonstrates *that* the editor works, not *what it supports*.
- **`examples/external-consumer`** — despite the name, not a runnable app. It is a compile harness: `typecheck:bundler`, `typecheck:declarations`, `typecheck:nodenext`, `build:arm`. It proves the published artifact resolves and type-checks under three module-resolution modes. Valuable, and not a shell.
- **No Electron shell at all.**

**Why the Electron gap is the expensive one.** The package's most platform-specific behavior is only reachable in Electron, and today the only Electron host is a large application. This has already cost the project twice, in the same week:

- **verveguy/liminis#965** — the toolbar create affordance was unreachable in a read-only editor. The package's own unit test asserted read-only worked and **passed**, because happy-dom reports a Lexical range selection where real Electron does not. The defect was found only because Zusammen adopted the package and drove the built app. A test that has never been red is not known to work.
- **verveguy/liminis#961** — a `toolbar`-surfaced annotation kind had no affordance at all. The type advertised `surface: 'toolbar'`, no code implemented it, and it was found by driving the real application rather than by any test.

Both are the same shape: jsdom-class environments are lenient about exactly the things (native selection, focus, contenteditable, clipboard) that this editor depends on. A minimal Electron shell that Playwright can drive over CDP would have caught both without needing a consumer application to exist.

**Overlap with verveguy/liminis-editor#1.** The corpus, the demo, and the shells currently under-cover the identical five bespoke constructs (callouts, toggles, Mermaid, C4, task lists), because nothing has ever forced them to be exercised end to end. verveguy/liminis-editor#1 re-measured this: task lists already have fixture coverage, leaving `CalloutNode`, `ToggleContainerNode`/`ToggleTitleNode`/`ToggleContentNode`, `MermaidNode`, and `C4Node` at genuine zero. The same fixture set is meant to feed both the corpus (#1) and this issue's web shell — a document that loads into the demo is also a corpus fixture.

**Sequencing.** This issue is deliberately blocked on verveguy/liminis-editor#1 rather than run in parallel, even though only the web shell half actually depends on the corpus (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Electron shell catches real-environment defects package-level e2e can't today (Priority: P1)

A maintainer wants to run package-level e2e tests against real Chromium/Electron — the environment that actually exposes selection, focus, contenteditable, and clipboard behavior — without needing a `liminis-app` checkout. They run the e2e suite against a minimal Electron test shell that hosts the editor with host services stubbed, and Playwright drives it over CDP the same way it already drives other Electron surfaces in this codebase.

**Why this priority**: This closes the gap that let verveguy/liminis#965 and verveguy/liminis#961 ship undetected — both defects were found only by driving a full downstream application, not by any test the package itself owned.

**Independent Test**: Check out the package in isolation (no `liminis-app`), build the Electron shell, and run the e2e suite against it. Confirm it runs and passes with no reference to `liminis-app` anywhere in the dependency graph or test configuration.

**Acceptance Scenarios**:

1. **Given** the editor is configured read-only, **When** the e2e suite exercises the create affordance against the Electron shell, **Then** the test observes real Electron's native selection/contenteditable behavior — reproducing the conditions under which verveguy/liminis#965 escaped a jsdom-based unit test.
2. **Given** an annotation kind configured with `surface: 'toolbar'`, **When** the e2e suite exercises the toolbar against the Electron shell, **Then** it asserts that a working affordance is actually rendered — reproducing the conditions under which verveguy/liminis#961 escaped detection.
3. **Given** the Electron shell is built, **When** Playwright connects to it, **Then** it connects over CDP, consistent with the existing Playwright approach used elsewhere in this codebase.
4. **Given** the Electron shell and its e2e suite, **When** they are built and run in isolation, **Then** neither depends on `liminis-app` — as a package, a build artifact, or a checkout.
5. **Given** the Electron shell, **When** its source is inspected, **Then** it is a minimal host — a window, the editor, and stubbed host services — not a second, more complete application.

---

### User Story 2 - Web shell demonstrates the full feature surface, from shared fixtures (Priority: P1)

Someone evaluating adoption, or a maintainer checking real rendered behavior in a browser, opens the web shell (`examples/demo`) and sees every node class the package supports rendered — not the single annotation kind it demonstrates today. The content they see is sourced from the same fixture set that feeds verveguy/liminis-editor#1's round-trip corpus, not hand-written demo prose maintained separately.

**Why this priority**: `examples/demo` currently proves the editor works at all, not what it supports. Growing it into a feature shell, fed by the same fixtures as the corpus, is the second half of closing the coverage gap described in the Background — and avoids the shells and the corpus drifting into two disagreeing sets of sample content.

**Independent Test**: Enumerate the node classes exported by `src/app/editor/editorNodes.ts`. Load the web shell and confirm every class with fixture-representable content is rendered, sourced from the shared fixture set rather than from `App.jsx`-authored content.

**Acceptance Scenarios**:

1. **Given** the shared fixture set also used by verveguy/liminis-editor#1's corpus, **When** the web shell loads its demo content, **Then** that content comes from those fixtures rather than from hand-written demo prose.
2. **Given** the five previously under-covered constructs identified in verveguy/liminis-editor#1 (callouts, toggles, Mermaid, C4, task lists), **When** the web shell renders its fixture content, **Then** each construct is visibly present and renders correctly.
3. **Given** a new node class is added to `editorNodes.ts` and a fixture exercising it is added to the shared fixture set, **When** the web shell is next built, **Then** it renders that construct without further hand-authored changes to the shell's demo content.

---

### Edge Cases

- A fixture filed under verveguy/liminis-editor#1's `known-defects/` classification (i.e., one that reveals a genuine, pre-existing round-trip fidelity loss) is not required to be excluded from the web shell; the shell renders whatever the shared fixture set contains. Whether to visually distinguish known-defect fixtures in the shell's UI is a Plan-stage decision.
- A node class that cannot be produced through the markdown-import pipeline the shared fixtures exercise (verveguy/liminis-editor#1's completeness-test exclusion list: `MarkNode`, `AutoLinkNode`, `CodeHighlightNode` — created only by live editor plugins, never by markdown import) is not required to be rendered via the fixture-driven path in the web shell, since no fixture can express it structurally.
- If verveguy/liminis-editor#1 stalls or takes materially longer than expected, splitting the Electron shell out into its own issue is an acceptable response, since it has no dependency on the corpus (see Assumptions). This spec does not preemptively perform that split.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An Electron test shell MUST exist as a minimal host — a window, the editor, and stubbed host services — distinct from `liminis-app`.
- **FR-002**: The Electron test shell MUST be drivable by Playwright over CDP, consistent with the existing Playwright approach used elsewhere in this codebase.
- **FR-003**: A package-level e2e suite MUST run against the Electron test shell with no dependency on `liminis-app` (as package, build artifact, or checkout).
- **FR-004**: The e2e suite MUST cover, at minimum, the create affordance in read-only mode (the shape of verveguy/liminis#965) and a `toolbar`-surfaced annotation kind's affordance (the shape of verveguy/liminis#961).
- **FR-005**: The web shell (`examples/demo`) MUST render every node class exported by `src/app/editor/editorNodes.ts` that can be produced through the markdown-import pipeline the shared fixtures exercise.
- **FR-006**: The web shell's demonstrated content MUST be driven from a shared fixture set rather than hand-written/hand-maintained demo content.
- **FR-007**: The fixture set driving the web shell MUST be the same fixture set used by verveguy/liminis-editor#1's round-trip corpus — a document that loads into the demo is also a corpus fixture.
- **FR-008**: Both the Electron shell and the web shell MUST consume `@liminis/editor` only through its declared subpath exports; neither may import from `@liminis/editor/src/...` or a relative path that reaches into the package's `src/`.
- **FR-009**: Both shells MUST build in CI.
- **FR-010**: The Electron shell's e2e suite MUST run in CI.

### Key Entities

- **Electron test shell**: a new, minimal Electron host for `@liminis/editor`, existing solely so package-level e2e can run against real Chromium/Electron.
- **Web shell**: `examples/demo`, grown from demonstrating one annotation kind into rendering every fixture-representable node class in `editorNodes.ts`.
- **Shared fixture set**: the fixture documents introduced by verveguy/liminis-editor#1's round-trip corpus, consumed by both that corpus and this issue's web shell.
- **Package-level e2e suite**: the Playwright-driven test suite that exercises `@liminis/editor` through the Electron shell, independent of `liminis-app`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The package-level e2e suite runs and passes against the Electron shell with zero references to `liminis-app` anywhere in its dependency graph or configuration.
- **SC-002**: The e2e suite includes and passes at least one test reproducing the read-only create-affordance shape of verveguy/liminis#965, and at least one test reproducing the `toolbar`-surfaced-kind shape of verveguy/liminis#961, both against real Electron.
- **SC-003**: The web shell renders every node class in `editorNodes.ts` that is producible via the shared fixture set, with each rendered instance traceable to a specific shared fixture rather than to hand-authored demo content.
- **SC-004**: CI builds both shells on every relevant run, and runs the Electron shell's e2e suite.
- **SC-005**: No import in either shell references `@liminis/editor/src/...` or a relative path crossing into the package's `src/`.

## Assumptions

- **Sequencing behind verveguy/liminis-editor#1 is a coordination choice, not a hard technical dependency for the whole issue.** Only the web shell half depends on the corpus's fixtures; the Electron shell half does not. The issue is sequenced behind #1 anyway because splitting it to gain a few hours of parallelism is not worth the coordination overhead, and #1 is expected to be quick (fixture authoring plus a completeness test, not design work). Building the shells first would produce bespoke demo documents that the corpus later replaces — rework, and a window where two sets of sample content disagree.
- **The Electron shell can be split out as its own issue if verveguy/liminis-editor#1 turns out to be slow.** It is independently valuable and is what catches the verveguy/liminis#965-class defect (a jsdom test passing while real Electron disagrees). This spec does not perform that split; it remains available as a fallback if #1's timeline slips.
- **"Every node class in `editorNodes.ts`"** mirrors the scope established in verveguy/liminis-editor#1: `CalloutNode`, `ToggleContainerNode`/`ToggleTitleNode`/`ToggleContentNode`, `MermaidNode`, and `C4Node` are the constructs currently at zero coverage; task lists (`CustomListItemNode`) already have fixture coverage per #1's re-measurement.
- **Exact fixture format/location shared between the corpus and the web shell** is a Research/Plan-stage decision; this spec only requires that both consume the same underlying fixture documents.
- **"Host services stubbed"** for the Electron shell means whatever host-provided services the editor depends on when running inside `liminis-app` (e.g., file/IPC access) are replaced with minimal stand-ins sufficient to exercise the editor's own behavior — not a reimplementation of `liminis-app`'s host layer. Exact stub surface is a Plan-stage decision.

## Out of Scope

- Building a second, more complete Liminis-like application as the Electron shell — it is a minimal host with stubbed services, not a `liminis-app` replacement.
- The GitHub Pages demo/docs site — filed separately; it builds on the web shell but is not part of this issue.
- Fixing any editor runtime defect a shell-driven e2e test newly uncovers, beyond what's needed to satisfy FR-004 — unless the fix is trivial and clearly in scope.
- The content and structure of the shared fixture corpus itself — owned by verveguy/liminis-editor#1.
- `examples/external-consumer` — already serves its distinct purpose (module-resolution type-checking) and is out of scope for this issue.

## Source References

- `examples/demo` — existing web app to be grown into the feature shell.
- `examples/external-consumer` — existing compile harness; unrelated shell type, unchanged by this issue.
- `src/app/editor/editorNodes.ts` — source of truth for the node classes the web shell must cover.
- verveguy/liminis#965 — read-only create-affordance defect that escaped a jsdom-based unit test.
- verveguy/liminis#961 — `toolbar`-surfaced annotation kind with no implemented affordance, found only by driving the full application.
- verveguy/liminis-editor#1 — feature corpus; shares its fixture set with this issue's web shell.
- verveguy/liminis#995 — extraction issue; `examples/demo` and `examples/external-consumer` already migrated into this repository.

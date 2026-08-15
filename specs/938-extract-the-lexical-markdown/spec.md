# Feature Specification: Carve the Lexical Markdown Editor into a Reusable `@liminis/editor` Package (Phase 1)

**Feature Branch**: `fabrik/issue-938`
**Created**: 2026-08-02
**Status**: Draft
**Input**: User description: "Extract the Lexical markdown editor into a reusable `@liminis/editor` package (unified annotation mechanism: comments + corrections)"

> **Scope note.** The original issue described a three-phase programme. It has been decomposed:
> **this issue is Phase 1 only** — carve the package, invert the app couplings, and have
> `liminis-app` consume it at behavioural parity. The unified annotation mechanism is **#939**
> (Phase 2, `blocked_by` this issue) and OSS hardening is **#940** (Phase 3, `blocked_by` #939).
> **No annotation or comment code lands in this issue.**

## Background

The markdown WYSIWYG editor (Lexical + mdast round-trip) currently lives embedded in `liminis-app/src/editor/**` — 182 files spanning the controlled `<Editor>` component, custom Lexical nodes, ~25 plugins, the C4 diagram subsystem, the mdast⇄Lexical mappers, and the round-trip fixture corpus built by #896 and hardened by #897–#919.

A near-identical **copy** was grafted into the Zusammen project (`verveguy/zusammen`, `app/src/editor/**`, forked from `liminis-app` @ `f95cce45`). Both copies have since diverged by accreting their own host feature on top of a shared core:

- **Liminis** added an AI **correction** feature (`CorrectionPanelPlugin`, `AmbientCorrectionPlugin`, `SelectionContextMenuPlugin`, `correction-yaml.ts`).
- **Zusammen** added a review **commenting** feature — durable, text-anchored comments rendered as live `@lexical/mark` MarkNodes, transparent on export.

Divergence is already costing: Zusammen's markdown round-trip idempotency fixes (its #62 work) are not in Liminis, and Liminis's post-#896 fixture corpus and round-trip fixes are not in Zusammen. Every future fix to the shared core must be hand-ported in both directions or silently lost. Zusammen's ADR-002 explicitly anticipated this outcome: "if/when Liminis is packaged as reusable libraries, replace copies with dependencies."

**This phase stops the bleeding.** It performs the physical move and the coupling inversion, and nothing else. Once the editor is one package with a curated public API and no host reach-ins, the two consuming apps can converge on a single implementation, and the annotation unification (#939) becomes a contained design problem rather than a design problem tangled up with a 182-file relocation.

### Where this is heading (context, not scope)

The eventual design insight — delivered in **#939**, not here — is that **comments and corrections are the same shape**: a range-anchored annotation over document text, surfaced with in-document markers plus affordances, with data flowing in and events flowing out. Rather than build an editor each host *extends* through a general-purpose plugin API, #939 bakes a single **annotation mechanism** into the package and expresses comments and corrections as two configured usages of it. **#940** then makes the package publishable.

Knowing that destination matters here only because it sets the boundary this phase must establish: the seam between package and app is drawn at **persistence**. Anything about text ranges, marks, rendering, and in-document UX is package-side; storage, lifecycle, identity, and higher-level panels are app-side.

### What moves, and what stays

**Moves into `packages/editor` (`@liminis/editor`)**

- The controlled `<Editor>` component (`content`/`onChange`), `app/App.tsx`, all custom Lexical nodes (`app/editor/nodes/**`), all generic plugins, the C4 subsystem (`app/editor/c4/**`), the markdown pipeline (`markdown/{parse,stringify}.ts`, `app/mapper/{mdastToLexical,lexicalToMdast}.ts`), `types.ts`, `styles.css`, and the round-trip fixture corpus under `app/mapper/__tests__/`. (**Resolved during Validate:** `messaging.ts` — the vestigial VS Code webview adapter — was **deleted rather than moved**. It had no importer anywhere in the repo, self-invoked a `window` listener at module load, and duplicated the wire-payload construction that `host/messages.ts` now owns as the single source. Its `VsCodeApi` interface and `declare global { Window.acquireVsCodeApi }` augmentation in `types.ts` went with it, since `export * from './types'` was leaking that global into every consumer of `.` and `./contract` — including the Electron preload. See ADR-075.)
- The correction plugins (`CorrectionPanelPlugin.tsx`, `AmbientCorrectionPlugin.tsx`, `SelectionContextMenuPlugin.tsx`, `correction-yaml.ts`) move **as-is and still bespoke**. They are in-editor UI, so they belong on the package side of the persistence seam; #939 re-expresses them as `kind: 'correction'`. Their store / context-graph coupling is inverted to injected props here, exactly like every other coupling.
- Editor-owned utilities currently misfiled in the app: `renderer/utils/fileTypes`, `shared/mathjax-config`, `renderer/stores/editorStore`.

**Stays in `liminis-app`**

- The correction lifecycle (accept/reject) and its persistence, the context-graph coupling, the Electron host bridge implementation (`messaging-electron.ts` or its successor), the logger implementation, and all higher-level panels.

  (**Resolved during Plan:** `renderer/stores/correctionStore.ts` was originally listed here, but moved package-side instead. It holds 24 lines of ephemeral popover state — `isOpen`, `position`, `selectedText` — persists nothing, and has no consumer outside the two editor plugins, so it sits on the package side of the persistence seam this spec draws. Only the YAML read/merge/atomic-write and the two MCP calls stay app-side, behind `CorrectionHostServices`. See ADR-075.)

**Couplings to invert** (present identically in both repo copies)

- Direct `messaging-electron` imports → an injected host-bridge adapter.
- `window.api.*` reach-ins in `AnchorScrollPlugin` and `WikiLinkExistencePlugin` → props/callbacks.
- `shared/logger` → injected logger with a safe default.
- Asset / link / wiki-link resolution → host-supplied callbacks.
- Deep imports by consumers (today `liminis-app` reaches into internals such as `nodes/diagram-utils` across 15 import sites) → a curated public `src/index.ts`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Liminis consumes the editor as a package (Priority: P1)

A Liminis developer changes editor behaviour by editing `packages/editor`, not `liminis-app/src/editor`. `liminis-app` imports `@liminis/editor` through a curated public entry point; the editor, its plugins, and the correction feature behave exactly as they do today.

**Why this priority**: This is the entire issue. Until the code physically moves and the app still works, nothing downstream can proceed — and the two copies keep diverging.

**Independent Test**: Delete `liminis-app/src/editor/**`, run `pnpm typecheck && pnpm lint && pnpm build && pnpm test` from the workspace root, launch the app, and exercise editing, diagrams, wiki links, images, anchor scrolling, and corrections.

**Acceptance Scenarios**:

1. **Given** the extraction is complete, **When** the full pre-commit suite runs at the workspace root, **Then** it passes and `liminis-app/src/editor/**` no longer exists.
2. **Given** a document open in Liminis, **When** the user edits, saves, and reopens it, **Then** the markdown round-trip output is byte-identical to the pre-extraction behaviour for every fixture in the existing corpus.
3. **Given** any consumer file in `liminis-app`, **When** it imports editor functionality, **Then** it imports only from a subpath declared in `@liminis/editor`'s `exports` map — no deep path into package internals.
4. **Given** a user working with corrections, **When** they trigger, accept, or reject one, **Then** behaviour is indistinguishable from before the extraction.
5. **Given** wiki links, images, C4/Mermaid diagrams, anchor scrolling, and the slash menu, **When** each is exercised in the running app, **Then** each behaves as before.

---

### User Story 2 - The package has no host coupling (Priority: P1)

The package can be reasoned about — and eventually consumed by Zusammen and external users — without knowing anything about Electron, Liminis's stores, or `window.api`.

**Why this priority**: A move that leaves the reach-ins in place is not an extraction; it is a directory rename. The inversion is what makes the package reusable, and it is far cheaper to do during the move than afterwards.

**Independent Test**: Grep `packages/editor` for `liminis-app`, `messaging-electron`, and `window.api`; separately, instantiate `<Editor>` in a test with no host services supplied and confirm it renders.

**Acceptance Scenarios**:

1. **Given** the package source, **When** it is inspected, **Then** it contains no import of `messaging-electron`, no `window.api.*` reach-in, and no import from `liminis-app`.
2. **Given** a host that supplies no logger, no host bridge, and no asset resolver, **When** `<Editor>` renders, **Then** it uses safe defaults rather than throwing.
3. **Given** `AnchorScrollPlugin` and `WikiLinkExistencePlugin`, **When** they need host data, **Then** they obtain it through props/callbacks supplied by the host.
4. **Given** the Electron host bridge, **When** `liminis-app` mounts the editor, **Then** it injects its adapter and all existing IPC-backed behaviour works unchanged.

---

### Edge Cases

- A capability `liminis-app` currently reaches for via a deep import has no public export → the public entry must grow to cover it; the answer is never a deep import or a re-exported internals barrel that defeats the curation.
- `styles.css` must load correctly from the package under the app's existing build configuration.
- The round-trip fixture corpus includes deliberate `known-defects` cases that assert *current, defective* behaviour — these must move and keep passing, not be "fixed" opportunistically during the move.
- Test files, mocks, and any path-based test configuration referencing `src/editor/**` must move with the code; a fixture silently dropped during relocation would look like a passing suite.
- The C4 subsystem has its own tests and a `render-to-string` path used outside the renderer (`liminis-app-mcp-server.ts`, `remote-session/routes.ts`) — these non-React consumers must keep working through the public entry.
- Type declarations consumed by `preload/index.ts` and `types/window-api.d.ts` come from `editor/types` today; the preload boundary must not end up importing renderer-side code.
- Circular dependency risk: if the package needs something from `liminis-app` that was not identified as injectable, that is a signal the seam is drawn in the wrong place — resolve by injection, not by a workspace back-dependency.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `packages/editor` workspace package named `@liminis/editor` MUST exist, following the existing `@liminis/shared-types` convention, with `src/index.ts` as its curated public entry. The package's `exports` map MAY declare a small number of additional technical subpaths where a single entry is not physically workable; each MUST be justified. (**Resolved during Plan:** four are declared — `.` the React surface, `./headless` a DOM-free surface because the Electron main process compiles without DOM libs, `./contract` the message shapes alone so the preload boundary keeps `import type`, and `./styles.css` which is not code. **Amended during Validate:** a fifth, `./markdown`, was added — `parseMarkdown`/mdast type guards/`getFileType` with no Lexical, MathJax or DOM in its import graph — because the root barrel drags ~2.27 MB of editor chunks into the `graph` and `workflow` windows, which host no editor. See ADR-075.)
- **FR-002**: The declared entry points MUST expose everything `liminis-app` needs — at minimum the controlled `<Editor>` component, the markdown pipeline (`parseMarkdown`, `stringifyMarkdown`, the mdast⇄Lexical mappers), the `types.ts` host-message contract, and the C4 render path. Consumers MUST NOT import anything not declared in the `exports` map; that map *is* the public API, and no deep path into package internals is permitted.
- **FR-003**: All host couplings MUST be inverted behind injected interfaces or props — host bridge/messaging, logger, and asset/link/wiki-link resolvers — each with a safe default so the package renders without them.
- **FR-004**: Editor-owned utilities (`renderer/utils/fileTypes`, `shared/mathjax-config`, `renderer/stores/editorStore`) MUST move into the package.
- **FR-005**: `liminis-app` MUST consume the package and delete `src/editor/**` at behavioural parity — no user-visible change to editing, diagrams, wiki links, images, anchor scrolling, or corrections.
- **FR-006**: The correction plugins MUST move into the package as-is, with their context-graph coupling inverted to injected services. Correction persistence and lifecycle (accept/reject) MUST remain in `liminis-app`. No unification with a general annotation mechanism happens in this issue. (**Resolved during Plan:** `correctionStore` moved package-side rather than being injected — it is ephemeral popover state with no consumer outside the two editor plugins, so injecting it would be prop-drilling to satisfy a file location. Persistence and lifecycle stayed app-side behind `CorrectionHostServices`, which is this requirement's substance. See ADR-075.)
- **FR-007**: The markdown round-trip fixture corpus and all editor tests MUST move into the package and continue to pass, including the `known-defects` cases, with no fixture added, removed, or altered.
- **FR-008**: No file in `packages/editor` may import from `liminis-app`, `messaging-electron`, or `window.api`, and `packages/editor` MUST NOT declare a dependency on `liminis-app`.
- **FR-009**: The package boundary — specifically that the seam is drawn at persistence — MUST be recorded as an ADR in `docs/project_notes/decisions/`, with the ADR index updated.

### Key Entities

- **`@liminis/editor` package**: The workspace package holding all editor mechanics. Its `exports` map is the whole public API surface.
- **Host Bridge**: The injected interface through which the package reaches its embedding environment (Electron IPC today, other adapters later) — the sole channel for host services.
- **Host callbacks**: Injected resolvers for assets, links, wiki-link existence, and anchor scrolling, replacing today's direct `window.api` reach-ins.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `liminis-app` runs entirely from `@liminis/editor`; `liminis-app/src/editor/**` no longer exists; `pnpm typecheck && pnpm lint && pnpm build && pnpm test` passes at the workspace root.
- **SC-002**: All external import sites in `liminis-app` — **25 import statements across 15 files**, in `renderer/`, `main/`, `preload/`, and `types/` — import only from subpaths declared in the package's `exports` map. (The original "15 today" counted files, not imports; both figures are stated separately so the acceptance check cannot be read as covering only 15 of the 25.)
- **SC-003**: Every markdown round-trip fixture that passes before extraction passes after it, with identical output; the fixture count is unchanged.
- **SC-004**: No file in `packages/editor` imports from `liminis-app`, `messaging-electron`, or `window.api`.
- **SC-005**: Correction behaviour in the running app is unchanged — trigger, render, accept, and reject all behave as before.

## Assumptions

- The package is consumed in-workspace (like `@liminis/shared-types`, `main`/`types` pointing at TypeScript source) and stays `private: true`. A standalone ESM + `.d.ts` build, peer dependencies, and resolving the patched `mdast-util-wiki-link@0.1.2` are all **#940**, not this issue.
- Correction plugins live package-side after this phase because they are in-editor UI and sit on the package side of the persistence seam. Only their store coupling is inverted; the code itself is not restructured.
- Behavioural parity is judged against `liminis-app`'s current behaviour and its existing test suites. "At parity" means no deliberate behaviour change, including no opportunistic fixes to `known-defects` fixtures.
- Zusammen source is available to a Fabrik worker **directly on the local filesystem at `~/dev/zusammen`** (verified: checked out on `main`, with `app/src/editor/**`, `app/src/shared/anchor-*.ts`, and `adrs/` all present). No `gh` clone or API access is required. The `/Users/adamb1/dev/autodesk/zusammen` path in the original issue was the author's own machine and is irrelevant to the worker. This phase does not need Zusammen source, but #939 does.
- `liminis-viewer` and `liminis-mobile` do not import the editor today and are unaffected.

## Out of Scope

- **The unified annotation mechanism** — comments and corrections as kinds, the anchor model, the resolver, marker rendering, mark-transparency on export. That is **#939**, which is `blocked_by` this issue. No annotation or comment code lands here.
- **OSS hardening** — standalone build, peer dependencies, wiki-link patch resolution, license, docs, demo. That is **#940**, `blocked_by` #939.
- **Zusammen's adoption and deletion of its editor copy** — a follow-up in the Zusammen repository.
- **Pulling up Zusammen's markdown round-trip idempotency fixes (its #62 work).** These are genuine improvements Liminis lacks, but adopting them is a behaviour change and therefore incompatible with this phase's parity constraint. It warrants its own issue once the package exists — flagged here so it is not lost.
- Enabling commenting as a Liminis product feature; migrating persisted data; changing correction *product* behaviour; `liminis-mobile`.
- A general-purpose third-party plugin API. The declared entry points are a curated export surface, not an extension mechanism.

## Source References

- `liminis-app/src/editor/**` — the code being extracted (182 files, 74 non-fixture)
- External consumers to rewire: `liminis-app/src/{preload/index.ts, types/window-api.d.ts, main/liminis-app-mcp-server.ts, main/remote-session/routes.ts}`, `renderer/components/{EditorColumn,MarkdownEditorPanel,ActionViewer,MarkdownSnippet,TableOfContents}.tsx`, `renderer/canvas/cards/body/{NoteCardBody,ReferenceCardBody}.tsx`
- `packages/shared-types/` — the workspace-package convention to follow
- `pnpm-workspace.yaml` — `packages/*` is already globbed; `patchedDependencies` carries `mdast-util-wiki-link@0.1.2` (relevant to #940)
- `specs/896-build-a-lexical-markdown/spec.md` and issues #897–#919 — the round-trip fixture corpus and fidelity fixes that must survive the move
- ADR-010 (bidirectional markdown conversion), ADR-057 (knowledge corrections pipeline), ADR-070 (dedicated Lexical node types)
- Zusammen local checkout: `~/dev/zusammen` (`app/src/editor/**`, `app/src/shared/anchor-*.ts`, `adrs/008-comment-anchor-resolution.md`, `adrs/012-comment-anchor-as-live-mark.md`) — needed by #939, not by this phase
- Follow-ups: **#939** (Phase 2 — unified annotation mechanism), **#940** (Phase 3 — OSS hardening)

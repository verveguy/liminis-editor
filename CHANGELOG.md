# Changelog

All notable changes to `@liminis/editor` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## 0.4.0 — 2026-08-23

### Breaking changes

- **`--vscode-*`, `--checkbox-border` and `--editor-brand` (26 names) stop
  being an override surface.** Every `--liminis-editor-*` name now carries
  its own real value directly, and every internal consumption site reads
  `--liminis-editor-*` only — the package no longer reads a legacy name
  anywhere. **Setting** a legacy name no longer themes the editor; **reading**
  one still works (each is declared as a one-line shim,
  `<legacy-name>: var(--liminis-editor-x);`, so `getComputedStyle` still
  returns a real value for a legacy name, e.g. for Zusammen's
  `--vscode-errorForeground`/`--vscode-focus-border` reads). Migrate any host
  still *setting* a legacy name to the corresponding `--liminis-editor-*`
  name instead. This was verified empirically (`getComputedStyle` in a
  running Electron shell), not assumed — see ADR-98's "Verified, not
  assumed" section for the CSS-cascade mechanics and why a shim can only
  ever preserve reads, not writes, without reintroducing the legacy
  dependence this change removes.
- **`--slashmd-*` (61 names) is gone entirely**, with no shim — verified
  zero hits across both `verveguy/zusammen` and `verveguy/liminis`. The
  ADR-092 defined-token baseline is updated to match.
- **`--liminis-editor-primary`/`-100` no longer forward to liminis-app's
  `--color-primary`/`-100`** (a token this package never defined, so the
  forward baked a meaningless literal, `#3b82f6`, whenever liminis-app
  hadn't set it — a defect, not a deliberate default). They now resolve to
  a value this package actually owns, derived from its own brand color
  (`--editor-brand`). Anything relying on the old `#3b82f6`-derived default,
  rather than overriding it, will see a visible color change.
- **`C4Component.tsx`'s six style expressions no longer read `--color-*`
  at all** — #98's one deliberate, documented exception (checking
  liminis-app's own Tailwind `--color-primary`/`-100`/`--color-muted-100`/
  `--color-muted-foreground` first, falling back to this package's own
  `--liminis-editor-*` default) is removed. Measured against both known
  consumers' current `main`, the two arms resolved identically in
  liminis-app and the fallback was otherwise dead — it changed no
  observable outcome anywhere it was deployed, while permanently coupling
  this package to a host-specific Tailwind namespace it does not define or
  control. Every internal consumption site under `src/` now reads
  `--liminis-editor-*` only, with no exception. A host that wants to
  override the C4 diagram colours sets `--liminis-editor-primary` and its
  siblings, unchanged by this issue. See ADR-98's amendment. (#101)

### Added

- **Every `--liminis-editor-*` name carries a real value directly** —
  including the 23 that previously baked a literal because their alias
  target was never defined by this package. See `README.md`'s "Theming: CSS
  custom properties" and ADR-98, superseding ADR-93. (#98)

### Changed

- **C4 diagram parsing, layout, and rendering now come from the published
  `@liminis/diagrams` package instead of a local copy.** `src/app/editor/c4/`
  is gone; `C4Component.tsx`, `C4Node.tsx`, `mdastToLexical.ts`, `index.ts`
  and `headless.ts` now import from `@liminis/diagrams/core`,
  `@liminis/diagrams/react`, and `@liminis/diagrams/server`. This is an
  internal source-of-implementation change only — `index.ts`'s and
  `headless.ts`'s exported names are unchanged, and no C4 parsing, layout,
  or rendering behavior changes. (#100)

## 0.3.0 — 2026-08-21

### Added

- **The package now *defines* `--liminis-editor-*` names, not only
  *consumes* them.** Every one of the 59 renamed (`0.2.0`) tokens gets a
  real `:root`/`.dark` declaration that aliases its previous
  (`--vscode-*`/`--slashmd-*`/`--color-*`/`--checkbox-*`) name via `var()`,
  so a host can read the new vocabulary directly — e.g.
  `getComputedStyle(el).getPropertyValue('--liminis-editor-foreground')` —
  and get a real, resolved value, unblocking
  [verveguy/zusammen#129](https://github.com/verveguy/zusammen/issues/129).
  A host that still only overrides a legacy name is unaffected: the alias
  resolves through that name's own `.dark`/`@media print` overrides at the
  point of use, so nothing changes for hosts (like `liminis-app`) that
  supply only `--color-primary`/`--color-muted-foreground` or any other
  legacy name. See `README.md`'s "Theming: CSS custom properties" and
  ADR-93. (#93)

### Changed

- **Three consumption sites' rendered color changes slightly**, as an
  accepted side effect of the above: `--vscode-errorForeground` and
  `--vscode-toolbar-hoverBackground` each had a real inconsistency between
  their own consumption sites' literal fallback values (pre-existing, not
  introduced by this change). Giving each token a single real default
  necessarily picks one value, unifying `.block-delete-button:hover
  .block-delete-icon` and `.search-close-button:hover` from `#f44336` to
  `#f14c4c` (matching `.editor-link-broken`'s existing color), and
  `.drag-handle:hover .drag-handle-icon` from `rgba(128, 128, 128, 0.1)` to
  `rgba(128, 128, 128, 0.15)` (matching the toolbar buttons' existing hover
  background). See ADR-93 for the full rationale. (#93)

### Breaking changes

- **The Lexical peer range moves from `^0.44.0` to `^0.49.0`** for `lexical`
  and all eleven `@lexical/*` packages (`code`, `code-prism`, `link`, `list`,
  `mark`, `markdown`, `react`, `rich-text`, `selection`, `table`, `utils`).
  These ranges do not overlap: a host still on Lexical 0.44.0–0.48.x will now
  see an unmet-peer-dependency warning on install, and must upgrade its
  Lexical family to 0.49.0 to install this version. The bump was verified by
  running the full suite, typecheck, lint, and build against 0.49.0 — no
  consumer-visible editor behavior changed; every check passed unmodified,
  with no source changes required. This is a deliberately narrow single-caret
  bump rather than a wide band spanning 0.44–0.49, since Lexical's `0.x`
  versioning permits every minor to break and a wide range would claim
  compatibility with four untested minors. See
  `docs/decisions/adr-92-lexical-peer-range-policy.md` and the `//peerDependencies`
  / `//lexicalPeerPolicy` notes in `package.json`. (#92)

### Fixed

- **A content reload no longer steals focus.** `CursorRestorePlugin` ended
  its restore with an unconditional `rootElement.focus()`, so any bump of
  `contentVersion` pulled the caret into the editor. A reload is not always
  the user's doing: when an agent writes the file that is open, the host
  bumps `contentVersion` too, and the editor grabbed focus out of whatever
  the user was typing in beside it — silently redirecting keystrokes into
  the document mid-sentence, repeatedly, for as long as the agent kept
  writing. The caret is now restored only when the editor already had
  focus; an unfocused editor is left entirely alone, selection included, so
  reconciliation cannot move focus as a side effect. This is the same rule
  `autoFocus` applies at mount — the editor never takes focus unasked — now
  covered on the reload path, which previously had no tests.

## 0.2.2 — 2026-08-19

### Added

- **`DocumentOutlineHandle` gains a markdown-derived entry source.** Issue
  #69's extraction dropped raw-mode support: an outline was only possible
  where a Lexical `<Editor>` is mounted. `handle.publishFromMarkdown(markdown)`
  now derives H1–H5 entries from markdown text alone — no Lexical editor, no
  DOM — using the same detection and text-extraction rules as the existing
  Lexical path, and `handle.setActiveLine(line)` resolves and highlights the
  active entry from a supplied source line, the raw-mode equivalent of the
  Lexical path's scroll-spy. Each markdown-derived entry carries a 1-based
  `line` (mdast's `position.start.line`), which a raw-mode host can scroll
  its own (non-Lexical) editor by. `deriveOutlineFromMarkdown` and
  `resolveActiveOutlineIndex` are also exported standalone. `<DocumentOutline>`
  gains an optional `onEntrySelect` prop, fired with the clicked entry
  alongside `handle.scrollToHeading` — needed on the markdown-derived path,
  where `scrollToHeading` no-ops with no Lexical editor to scroll. The
  existing Lexical/WYSIWYG path (`OutlinePlugin`, `<Editor
  documentOutlineHandle>`) is unchanged. See `docs/editor-api.md`'s "Raw-mode
  / markdown-derived entries" section. (#84)

## 0.2.1 — 2026-08-19

### Added

- **`<App>` now forwards `documentOutlineHandle` to its inner `<Editor>`.**
  Issue #69 added `documentOutlineHandle` to `EditorProps` but not to
  `AppProps`, so `<App>` consumers — most consumers, since `<App>` rather
  than `<Editor>` is what's typically embedded — had no way to reach the
  document outline. Pass `documentOutlineHandle` to `<App>` the same way you
  would to `<Editor>`; see `docs/editor-api.md`'s Document Outline section
  for the `<App>` example. (#80)

## 0.2.0 — 2026-08-19

Two breaking changes share this release, held together deliberately so
`liminis-app` and Zusammen absorb one breaking upgrade instead of two
consecutive ones.

### Breaking changes

- **The Tailwind requirement is dropped.** The four sites that previously
  depended on a host having Tailwind v4 configured with an `@source`
  directive now ship as semantic classes in `styles.css`
  (`.editor-loading`, `.editor-error-banner`, `.editor-app-root`,
  `.editor-container`). Hosts no longer need Tailwind installed, configured,
  or scanning this package's sources at all. See ADR-086. (#49)

- **The theming vocabulary is renamed off `--vscode-*`, `--slashmd-*`,
  `--color-*` and `--checkbox-*` to a single package-owned prefix,
  `--liminis-editor-*`.** All 59 CSS custom properties consumed by `src/` —
  previously split across those four inconsistent prefixes (`--slashmd-*`
  30, `--vscode-*` 24, `--color-*` 4, `--checkbox-*` 1) — are now documented
  and consumed under a single `--liminis-editor-*` prefix. See ADR-087.
  (#51)

  **This is not a silent break.** Every renamed property resolves through a
  fallback chain — `--liminis-editor-x` first, then that property's specific
  previous name, then its existing default — so a host that still only
  supplies `--vscode-*`/`--slashmd-*`/`--color-*`/`--checkbox-*` overrides
  keeps theming exactly as before. Nothing loses its theme on upgrade.

  **The old names are deprecated as of this release and will be removed in
  a future major version.** There is no forced migration deadline attached
  to `0.2.0` itself, but hosts relying on the old names should plan to
  migrate to `--liminis-editor-*` before that removal ships. See
  `README.md`'s "Migrating from the old names" section for the full
  previous-name -> new-name mapping.

  Neither known consumer has migrated, and both keep working — which is the
  fallback layer doing exactly the job it exists for. Measured rather than
  assumed, at the time of writing:

  - `liminis-app` supplies two of the four `--color-*` properties this
    package consumes: `--color-primary` (itself aliased to `var(--primary)`)
    and `--color-muted-foreground`. Those overrides continue to apply through
    the fallback chain.
  - Zusammen supplies 19 `--vscode-*` overrides in
    `app/src/renderer/index.css`, and is still on `^0.1.1`. It picks this
    release up when it upgrades, with its theming intact.

  [verveguy/zusammen#125](https://github.com/verveguy/zusammen/issues/125) was
  filed to port the rename into a vendored copy of this package's source. It
  is closed as completed, but no code changed: that vendored copy no longer
  exists, because Zusammen now installs from the registry.

### Added

- **`AnnotationEditorHandle` gains `getMarkRects(annotationIds?)`, which is a
  breaking change for any code that implements, constructs, or type-checks
  against `AnnotationEditorHandle`.** As a required interface member,
  TypeScript rejects any hand-built object satisfying the interface — a test
  double, an alternative host, a wrapper — that doesn't supply it, e.g.
  `TS2741: Property 'getMarkRects' is missing`. This is a compile-time break
  only: it does not change behavior for code that merely calls methods on a
  handle instance the package itself supplies, for example via
  `annotationEditorHandleRef`. **The fix is one line:** add a `getMarkRects`
  implementation to any hand-built object satisfying `AnnotationEditorHandle`.

  `getMarkRects` exposes current on-screen geometry for existing annotation
  marks — a host can now look up where an already-created annotation is
  rendered, not just the one-shot rect delivered at creation time. Returns a
  `Map<string, DOMRect[]>` keyed by annotation id, one `DOMRect` per
  constituent `MarkNode` (a multi-block annotation spans several), computed
  fresh from `getBoundingClientRect()` on every call. Omitting `annotationIds`
  returns geometry for every annotation with a currently live mark; an id
  with no live mark is simply absent, never an error. (#73)

# Changelog

All notable changes to `@liminis/editor` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## 0.2.0 (unreleased)

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

- **`AnnotationEditorHandle` gains `getMarkRects(annotationIds?)`**, exposing
  current on-screen geometry for existing annotation marks — a host can now
  look up where an already-created annotation is rendered, not just the
  one-shot rect delivered at creation time. Returns a `Map<string, DOMRect[]>`
  keyed by annotation id, one `DOMRect` per constituent `MarkNode` (a
  multi-block annotation spans several), computed fresh from
  `getBoundingClientRect()` on every call. Omitting `annotationIds` returns
  geometry for every annotation with a currently live mark; an id with no
  live mark is simply absent, never an error. (#73)

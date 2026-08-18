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

- **The theming vocabulary is renamed off `--vscode-*` to a package-owned
  prefix, `--liminis-editor-*`.** All 59 CSS custom properties consumed by
  `src/` — previously split across four inconsistent prefixes (`--slashmd-*`
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

  `liminis-app` required no change (it supplied none of the old-prefix
  overrides). Zusammen's vendored copy of the editor source and its
  `index.css` were ported to the new names in
  [verveguy/zusammen#125](https://github.com/verveguy/zusammen/issues/125).

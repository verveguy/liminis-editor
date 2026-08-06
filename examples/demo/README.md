# `@liminis/editor` demo

A small React app that renders the editor and one configured annotation kind.

## Run it

From the **repository root**:

```bash
pnpm demo
```

That builds `@liminis/editor`, packs it, installs the tarball into this
directory, and opens the demo at <http://localhost:5178>.

If you would rather do it by hand:

```bash
pnpm --filter @liminis/editor run build
# `pnpm pack` prints the absolute path of the tarball it wrote — capture it
# rather than hard-coding a version that goes stale on the next bump.
TARBALL=$(cd packages/editor && pnpm pack --pack-destination /tmp | tail -1)
cd examples/demo
pnpm install --ignore-workspace
pnpm add --ignore-workspace "$TARBALL"
pnpm dev
```

Note that `pnpm add` rewrites this directory's `package.json` to point at that
tarball path. `pnpm demo` snapshots and restores the manifest for you; if you run
the steps by hand, `git checkout examples/demo/package.json` afterwards.

## What to try

- Type. Make a heading, a table, a task list, a fenced code block.
- Watch the **Outline** panel on the left. It is built with
  `@liminis/editor/markdown` — the pure-mdast entry, with no editor involved.
- Select a passage and click **Note** in the toolbar. A highlight marker
  appears and the annotation shows up in the sidebar.
- Edit the text *around* an annotated passage, then click **Re-resolve
  anchors**. The anchor is found again at its new offset — that is the point of
  the anchor model, and it is `resolveAnchors` from
  `@liminis/editor/annotations` doing it.

## Why it installs a tarball

This demo is deliberately **not** a pnpm workspace member and installs the
packed package with `--ignore-workspace`. A workspace symlink would resolve
`@liminis/editor` to `packages/editor/src` and the demo would keep working even
if the built artifact were broken — exactly the drift FR-008's
"public entry points only" constraint exists to prevent.

For the same reason, every import in `src/App.jsx` is one of the package's
public entries (`@liminis/editor`, `@liminis/editor/markdown`,
`@liminis/editor/annotations`, `@liminis/editor/styles.css`). No deep paths.

## Note on styling

`import '@liminis/editor/styles.css'` is required. Without it the editor renders
as unstyled text and annotation markers are invisible — no error, just wrong
output. `demo.css` in this directory styles only the surrounding shell.

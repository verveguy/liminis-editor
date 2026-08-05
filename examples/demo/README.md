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
cd packages/editor && pnpm pack --pack-destination /tmp && cd -
cd examples/demo
pnpm install --ignore-workspace
pnpm add --ignore-workspace /tmp/liminis-editor-0.1.0.tgz
pnpm dev
```

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

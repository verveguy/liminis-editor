# `@liminis/editor` Electron e2e shell

A minimal Electron host for `@liminis/editor` — a window, the editor, and
stubbed host services (verveguy/liminis-editor#2). It exists solely so a
package-level e2e suite can run against real Chromium/Electron, the
environment that exposes selection, focus, contenteditable and clipboard
behavior that jsdom-class test environments do not.

It is **not** a second, more complete application. There is no file I/O, no
IPC, no preload script, and no packaging step — this is deliberately smaller
than `liminis-app`, not a lighter clone of it.

## Why this exists

The package's own unit tests run under `happy-dom`
(`vitest.config.ts`), which is lenient about exactly the browser behaviors
this editor depends on. Two real defects shipped because of that gap, caught
only by driving a full downstream application:

- **verveguy/liminis#965**: the toolbar's create affordance was unreachable
  in a read-only editor. happy-dom reported a Lexical range selection for a
  native double-click where real Electron does not.
- **verveguy/liminis#961**: a `toolbar`-surfaced annotation kind had no
  implemented affordance at all.

`e2e/electron-shell.spec.ts` reproduces both shapes against this shell,
driven by Playwright over CDP via its built-in `_electron` launcher.

## Stubbed host services

The renderer supplies no `EditorHostServices` at all. `@liminis/editor`'s
built-in defaults (`resolveHostServices`'s no-op `bridge`/`logger`/etc.,
exported from the package's root entry) are already a safe stand-in — that
*is* the stub. Neither e2e scenario touches host/bridge communication, so an
explicit, observable stub was not worth the added surface area.

## Public entries only

`src/renderer/App.jsx` imports only `@liminis/editor` and
`@liminis/editor/styles.css` — the package's root entry and its stylesheet,
never a deep path into `dist/` or `src/` (FR-008). `main.cjs`, the Electron
main process, imports nothing from `@liminis/editor` at all; if a future
change needs package types or helpers there, `@liminis/editor/headless` is
the subpath built for a DOM-free process — the root entry assumes one.

## Build and run

From the **repository root**:

```bash
pnpm build:examples
```

That builds and packs `@liminis/editor` once and installs the tarball into
this directory (and into `examples/demo`), the same way an external adopter
would — see `examples/demo/README.md` for why a packed tarball rather than a
workspace link.

To build and run this shell by hand:

```bash
# From the repository root.
pnpm build
TARBALL=$(pnpm pack --pack-destination /tmp | tail -1)
cd examples/electron
pnpm install --ignore-workspace
pnpm add --ignore-workspace "$TARBALL"
pnpm run build
```

Then, from this directory, launch it directly (no e2e harness) with:

```bash
node_modules/.bin/electron .
```

## Running the e2e suite

```bash
# From examples/electron, after the build steps above.
pnpm run test:e2e
```

Two specs, both launching a fresh Electron process:

1. An editable document — selects text with a real double-click, clicks the
   **Note** toolbar button, asserts a highlight marker renders (#961 shape).
2. The same, launched with `--readonly` (which `main.cjs` turns into
   `?readonly=1` on the loaded page, toggling `<Editor editable={false}>`) —
   the create affordance must still work (#965 shape).

CI runs this suite under `xvfb-run`, since even a "headless" Linux runner
needs a virtual display for a real `BrowserWindow` to open.

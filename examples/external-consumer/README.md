# External-consumer fixture

Not an example — a **test fixture**. This is the CI proxy for a real external
adopter of `@liminis/editor` (#940 / FR-009, SC-005).

It is driven entirely by `scripts/verify-package.mjs`; run it from the
repository root:

```bash
pnpm verify:package
```

That builds the package, packs it, installs the tarball here with
`--ignore-workspace` (a real install, not a workspace symlink), type-checks
this project, builds three measurement arms, and asserts the entry-graph
boundaries the package's six subpaths exist to keep.

## What lives here

| Path | Role |
|---|---|
| `src/subpaths.ts` | Imports every public subpath and references every binding, so `noUnusedLocals` proves each resolved to a real export rather than to `any`. Type-checked twice — under `moduleResolution: "bundler"` and `"nodenext"`. Only `nodenext` catches an emit whose relative specifiers are missing their `.js` extensions. |
| `src/arms/markdown-only.ts` | A consumer that only reads markdown. Its module graph is asserted to contain no MathJax, no Lexical, no react-dom (SC-002). |
| `src/arms/annotations-off.tsx` | `<Editor>` with no annotation kinds. Asserted to load no annotation module eagerly (SC-004). |
| `src/arms/annotations-on.tsx` | The control: the same editor with a kind configured, plus the headless anchor API. Without it, the assertion above could be passing because the probe looks in the wrong place. |
| `vite.config.js` | Builds one arm, selected by `ARM`, and emits a `modules.json` recording each chunk's modules and its static vs. dynamic imports. |

## This fixture relies on `auto-install-peers`

The manifest declares only `react` and `react-dom`. It never declares `lexical`
or any `@lexical/*` package, even though the arms import code that needs all
fourteen — pnpm's `auto-install-peers` default (true) resolves them.

That is deliberate. Peers arriving without being asked for is exactly what a
default adopter gets (pnpm v8+ and npm v7+ both auto-install them), and this
fixture exists to model a real adopter. Declaring them here would make it pass
for a reason an adopter does not enjoy — and would stop it from proving that
the package's `peerDependencies` are actually complete.

The cost is a dependency on a package-manager default. With
`auto-install-peers=false` the install still exits 0 and **both type-checks
still pass** — `skipLibCheck` hides the unresolved types — and the failure only
appears at arm-build time as `Rolldown failed to resolve import "lexical"`,
which names neither the peer nor the setting. `verify-package.mjs` therefore
resolves every declared peer from the installed copy right after install, so
the failure is named where the cause is still visible.

If you must run this where that default is off (a corporate `.npmrc`, yarn),
add the fourteen peers to this manifest — the package `README.md` lists them.

## Measurement

The measurement reads `modules.json`, not the emitted JavaScript. Grepping
bundled output for identifier substrings would not work: minification loses the
names, and a chunk *containing* the string `annotation` says nothing about
whether that chunk is ever loaded.

`node_modules/` and `dist/` here are build products — both are gitignored.

# `@liminis/editor`

A Lexical-based markdown WYSIWYG editor that round-trips through mdast, with a
host-injection seam so it can be embedded in an Electron app, a browser app, or
anything else that can supply a message channel.

It is the editor from [Liminis](https://github.com/verveguy/liminis), extracted
into this repository so it can stand on its own. MIT-licensed.

Its history, and how to read the `ADR-0NNN`, `FR-NNN` and `#NNN` references that
travelled with the code, are recorded in [`docs/provenance.md`](./docs/provenance.md).

## What you get

- **`<Editor>`** — a WYSIWYG markdown editor. Tables, task lists (including in
  ordered lists), footnotes, definition lists, callouts, toggles, code blocks
  with Prism highlighting, images, LaTeX equations, Mermaid diagrams, C4
  diagrams, YAML frontmatter, and wiki-links.
- **A markdown pipeline** — `parseMarkdown` / `stringifyMarkdown` and the mdast
  ↔ Lexical mappers, usable with no editor mounted.
- **An annotation mechanism** — range-anchored markers over document text that
  survive edits, with per-*kind* configuration. Comments and corrections are not
  separate features; they are two configurations of one mechanism. Entirely
  opt-in: configure no kinds and none of it loads.
- **A host seam** — every service the editor needs from its environment is an
  optional injected function with a safe default, so `<Editor>` renders in a
  host that supplies nothing at all.

## Install

> **This package is not published.** It is `private: true` and `@liminis/editor`
> does not exist on the npm registry, so `pnpm add @liminis/editor` will fail.
> That is deliberate — see [Consuming it](#consuming-it) below for the mechanism
> that actually works, and `docs/decisions/adr-078.md` for why.

React and Lexical are **peer dependencies**, so your app resolves exactly one
copy of each. Two React copies produce `Invalid hook call`; two Lexical copies
produce a broken editor context — peering is what prevents both.

```bash
pnpm add react@^19 react-dom@^19 \
  lexical@^0.44 @lexical/react@^0.44 @lexical/code@^0.44 \
  @lexical/code-prism@^0.44 @lexical/link@^0.44 @lexical/list@^0.44 \
  @lexical/mark@^0.44 @lexical/markdown@^0.44 @lexical/rich-text@^0.44 \
  @lexical/selection@^0.44 @lexical/table@^0.44 @lexical/utils@^0.44
```

pnpm v8+ and npm v7+ install peers automatically, so in practice the first
command is usually enough.

The package ships ESM plus `.d.ts` declarations. It has no CommonJS build.

## Quickstart

```tsx
import { useState } from 'react'
import { Editor } from '@liminis/editor'
import '@liminis/editor/styles.css'   // required — see "Styling" below

export function MyEditor() {
  const [markdown, setMarkdown] = useState('# Hello\n\nStart typing.')

  return (
    <Editor
      initialContent={markdown}
      onChange={setMarkdown}
    />
  )
}
```

`initialContent` is markdown text; `onChange` receives markdown text back.
The editor owns the Lexical state in between — you never see it unless you want
to.

## Entry points

Seven, and they are not stylistic. Each keeps a specific dependency graph out of
a specific consumer, and importing the wrong one is measured in megabytes.

| Entry | Contains | Import it when |
|---|---|---|
| `@liminis/editor` | Everything: `<Editor>`, `<App>`, the host seam, the markdown pipeline, the mappers | You are rendering an editor |
| `@liminis/editor/markdown` | `parseMarkdown`, mdast type guards, `getFileType`, the wiki-link mdast extension. Pure mdast/micromark | You only need to *read* markdown — a search snippet, a table of contents, a chunker |
| `@liminis/editor/annotations` | The anchor model, resolver, block structure, and annotation types. DOM-, React- and Lexical-free | You are resolving or storing annotations outside a rendered editor |
| `@liminis/editor/headless` | The C4 subsystem, server-side SVG rendering, MathJax lite adaptor | You are rendering diagrams or equations with no DOM (a server, a worker, an Electron main process) |
| `@liminis/editor/contract` | The host-message shapes, as types | You are writing a boundary that must not pull renderer code in — an Electron preload script. Use `import type` |
| `@liminis/editor/nodes` | `editorNodes` (the exact Lexical node array `<Editor>` configures itself with), plus `importMarkdownToLexical` / `exportLexicalToMdast` | You are building your own headless Lexical `createEditor` — for example, to test the markdown↔Lexical mapper without mounting `<Editor>` |
| `@liminis/editor/styles.css` | The stylesheet | Always, once, in your app |

Three of these are load-bearing in ways that are easy to undo by accident:

- **`./markdown` is deliberately *not* `./headless`.** `./headless` re-exports
  the MathJax configuration, whose ~90 bare
  `import '@mathjax/src/js/input/tex/…Configuration.js'` lines are genuinely
  side-effectful and cannot be tree-shaken by anyone — roughly 1.9 MB. If all
  you do is parse markdown, import `./markdown` and you never pay it.
- **`./contract` is only type-free of `zod` if you `import type`.** A value
  import pulls the schemas in.
- **`./nodes` is the one entry that legitimately requires Lexical and React** —
  its whole purpose is exporting the node classes the mapper instantiates. It
  inherits `./headless`'s MathJax-lite exception (loading it evaluates the same
  ~90 side-effectful TeX-configuration imports, via `EquationNode`), but it
  pulls in none of Mermaid's, C4's, or Prism's rendering weight — those
  decorator components are lazy-loaded and never evaluate in a headless editor.

Do not deep-import into `dist/`. Everything intended for consumers is on one of
the seven entries above; anything else is internal and will move.

## Styling

The editor's markup carries semantic class names (`editor-paragraph`,
`editor-heading-h1`, `annotation-mark-*`, …). **`@liminis/editor/styles.css`
defines them.** Importing it is not optional — without it the editor renders as
unstyled text, and annotation markers are invisible. This failure is silent:
nothing errors, it just looks wrong.

```ts
import '@liminis/editor/styles.css'
```

The sheet is plain CSS — OKLCH design tokens plus the editor's own rules. It has
no build-step requirement and works with any bundler.

### TypeScript needs to be told CSS imports exist

If you type-check your app, that import is an error out of the box:

```text
error TS2882: Cannot find module or type declarations for side-effect import
  of '@liminis/editor/styles.css'.
```

This is a TypeScript language limitation, not something the package can fix from
its side: TypeScript has no built-in meaning for a `.css` module, so *any*
stylesheet import from *any* package needs an ambient declaration. Most React
starters already provide one and you will never see this. If yours does not, one
line anywhere in your project's `include` fixes it:

```ts
// css.d.ts
declare module '*.css'
```

If you are on Vite, adding its client types does the same job and covers assets
too:

```jsonc
// tsconfig.json
{ "compilerOptions": { "types": ["vite/client"] } }
```

Note the contrast with the failure above: forgetting the *import* fails
silently, while adding it without a declaration fails loudly at compile time.
Neither is a package defect, but only one of them tells you what is wrong.

### If you use Tailwind

Some of the editor's markup also uses Tailwind utility classes. Tailwind v4
generates utilities by scanning your source, and **its automatic source
detection skips `node_modules`** — so without telling it where to look, those
classes are simply absent. Again: silent, not an error.

Add an explicit `@source` for the package's built output in the CSS file where
you import Tailwind:

```css
@import "tailwindcss";
@source "../node_modules/@liminis/editor/dist";
```

Adjust the relative path to point at your installed copy. In a pnpm workspace
the real path may be under `node_modules/.pnpm/` — pointing `@source` at the
symlinked path works, but verify a distinctive utility class actually appears in
your generated CSS rather than assuming it.

## Annotations

An annotation is a range-anchored marker over document text whose anchor
survives edits to the surrounding document. The mechanism is entirely opt-in:
supplying an `annotationKinds` prop is what turns it on. With no kinds
configured, the annotation UI is never loaded — it sits behind a `React.lazy()`
boundary, so it is not even in the chunk your app downloads.

```tsx
<Editor
  initialContent={markdown}
  onChange={setMarkdown}
  annotationKinds={{
    comment: {
      markerStyle: 'highlight',
      createAffordance: { surface: 'toolbar', label: 'Comment' },
    },
  }}
  annotations={annotations}
  onCreateAnnotation={(event) => { /* mint an id, persist, add to `annotations` */ }}
  onActivateAnnotation={(id) => { /* open your own thread panel */ }}
/>
```

The package owns anchor mechanics and marker rendering. Identity, storage and
lifecycle stay in your app — `id` is opaque to the package and `payload` is
carried through untouched. See [`docs/annotations.md`](./docs/annotations.md).

Configuring more than one kind on the same `createAffordance.surface` offers
one toolbar button or context-menu entry per kind, in `annotationKinds`'
declaration order.

A `toolbar`-surfaced affordance works the same way whether `editable` is
`true` or `false` — annotating is decoupled from editing, so a selection in a
read-only editor still shows the floating toolbar with the configured
affordance (formatting controls are omitted there, since they would be
inert).

## Documentation

- [`docs/editor-api.md`](./docs/editor-api.md) — the `<Editor>` props and the
  host-injection seam.
- [`docs/markdown-pipeline.md`](./docs/markdown-pipeline.md) — `parseMarkdown`,
  `stringifyMarkdown`, the mdast ↔ Lexical mappers, and wiki-links.
- [`docs/annotations.md`](./docs/annotations.md) — kinds, anchors, resolution,
  and marker styling.

## Consuming it

Because the package is unpublished, consumers install a **packed tarball** rather
than a registry version:

```bash
# in this repository
pnpm build && pnpm pack --pack-destination /tmp

# in the consuming application
pnpm add /tmp/liminis-editor-0.1.0.tgz
```

Applications that do this commit the tarball into their own tree (typically under
`vendor/`) and pin it by filename, so the install is reproducible and needs no
credentials for this private repository. `pnpm pack` works on a private package;
only `npm publish` is blocked, which is exactly the guard intended.

A git dependency on this repository does **not** work, and the reasons are
measured rather than assumed: `files` excludes the directory `main` points at, so
a git install lands only the manifest and docs; the build runs from `prepack`,
which a git install never invokes; and pnpm does not apply `publishConfig` for git
installs. Adding a `prepare` script to work around this would change what an
eventual npm tarball ships, so it has been deliberately avoided.

## Demo

```bash
pnpm demo
```

Builds the package, packs it, installs the tarball into `examples/demo/` outside
any workspace, and starts the Vite dev server. The demo imports only the public
entry points, so it breaks when an adopter would break. See
[`examples/demo/README.md`](./examples/demo/README.md).

## Development

This repository stands alone. It has no `pnpm-workspace.yaml` and no dependency
on any other checkout — the `examples/` directories are external consumers by
construction, not workspace members.

```bash
pnpm install
pnpm build          # tsc emit + tsc-alias + asset copy → dist/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint src/ tests/
pnpm test           # vitest run
```

That sequence is what CI runs, in that order. One further gate needs a real built
artifact and so runs separately:

```bash
pnpm verify:package
```

This builds, packs, installs the tarball into `examples/external-consumer/` with
`--ignore-workspace`, type-checks it under `bundler` and `nodenext` module
resolution, builds three measurement arms, and asserts the entry-graph boundaries
the seven export subpaths exist to keep — that `./markdown` pulls in no MathJax,
no Lexical and no react-dom, and that annotations stay behind a lazy boundary.
It is the check that proves the package is publishable without publishing it.

## License

MIT. See [LICENSE](./LICENSE).

This package vendors a modified copy of `mdast-util-wiki-link` (MIT, Mark
Hudnall); its license and the modifications are documented at
`dist/markdown/vendor/mdast-util-wiki-link/`.

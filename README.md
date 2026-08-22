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

```bash
pnpm add @liminis/editor
```

> **This is `0.x`.** Minor versions may contain breaking changes; patch versions
> will not. The seven declared subpath exports are the public API — anything
> reachable by a deeper path is private and may move without notice. Breaking
> changes are listed in the changelog with a migration note.

React and Lexical are **peer dependencies**, so your app resolves exactly one
copy of each. Two React copies produce `Invalid hook call`; two Lexical copies
produce a broken editor context — peering is what prevents both.

```bash
pnpm add react@^19 react-dom@^19 \
  lexical@^0.49 @lexical/react@^0.49 @lexical/code@^0.49 \
  @lexical/code-prism@^0.49 @lexical/link@^0.49 @lexical/list@^0.49 \
  @lexical/mark@^0.49 @lexical/markdown@^0.49 @lexical/rich-text@^0.49 \
  @lexical/selection@^0.49 @lexical/table@^0.49 @lexical/utils@^0.49
```

> **The Lexical peer ranges are single-caret, not a wide band.** Lexical is
> also `0.x`, where every minor is permitted to break — unlike React's range
> above, which spans an untested-but-stable range, the Lexical range names
> exactly the one minor this package is built and tested against. Expect it
> to move forward (e.g. to `^0.50`) only after this package has adopted and
> tested that release, not automatically at every upstream release. See
> `docs/decisions/adr-92-lexical-peer-range-policy.md`.

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

| Entry | Contains | Import it when | Lexical-free |
|---|---|---|---|
| `@liminis/editor` | Everything: `<Editor>`, `<App>`, the host seam, the markdown pipeline, the mappers | You are rendering an editor | No |
| `@liminis/editor/markdown` | `parseMarkdown`, mdast type guards, `getFileType`, the wiki-link mdast extension. Pure mdast/micromark | You only need to *read* markdown — a search snippet, a table of contents, a chunker | Yes |
| `@liminis/editor/annotations` | The anchor model, resolver, block structure, and annotation types. DOM-, React- and Lexical-free | You are resolving or storing annotations outside a rendered editor | Yes |
| `@liminis/editor/headless` | The C4 subsystem, server-side SVG rendering, MathJax lite adaptor | You are rendering diagrams or equations with no DOM (a server, a worker, an Electron main process) | Yes |
| `@liminis/editor/contract` | The host-message shapes, as types | You are writing a boundary that must not pull renderer code in — an Electron preload script. Use `import type` | Yes (type-only) |
| `@liminis/editor/nodes` | `editorNodes` (the exact Lexical node array `<Editor>` configures itself with), plus `importMarkdownToLexical` / `exportLexicalToMdast` | You are building your own headless Lexical `createEditor` — for example, to test the markdown↔Lexical mapper without mounting `<Editor>` | No |
| `@liminis/editor/styles.css` | The stylesheet | Always, once, in your app | N/A (not JS) |

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

### Why there's no `sideEffects` field

`package.json` deliberately does not declare `sideEffects`. If your bundler's
tree-shaking pass ever runs against this package's own graph and you're
tempted to add one to prune it further, don't — the field is permanently
prohibited (ADR-075 §4), not merely undeclared for now.

The failure it would cause is a transitive one: marking this package's modules
side-effect-free changes how a whole-graph bundler like rolldown chunks
everything reachable from it, including third-party code the package merely
imports. `prismjs`, pulled in via `@lexical/code-prism`, has its core chunk
separated from `prism-clike.js`, a companion module that mutates a bare
`Prism` global at import time. Once the two are split into different chunks,
`prism-clike.js` runs before `Prism` exists:

```
ReferenceError: Prism is not defined
```

The app that hits this doesn't fail to build — it fails to *render*, since the
error is thrown by code Prism's own language-grammar files depend on running
first. This can't be fixed from inside this package: the hazard lives in
`prismjs`'s own module structure, three levels removed, so no `sideEffects`
value this package could declare about *its own* files changes how the bundler
chunks `prismjs`.

## Versioning policy

This package is `0.x`. While it stays there:

- **Minor versions may break.** `0.1.0` → `0.2.0` is not guaranteed compatible.
- **Patch versions may not.** `0.1.0` → `0.1.1` is a bug fix only.
- **The seven subpaths above are the supported API.** Anything reachable only
  by a deeper import path — `@liminis/editor/dist/...` or a relative path into
  `src/` — is private. It can move or disappear in a patch release.

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

### Theming: CSS custom properties

The editor's colors, borders and a few layout metrics are all CSS custom
properties under a single package-owned vocabulary, `--liminis-editor-*`.
Every one of them resolves with no host configuration at all, and every one
of them *carries its own real value* declared at `:root`/`.dark` in
`styles.css` — there is no indirection to look through (ADR-98). The table
below exists so you can *override* a palette, and also so you can *consume*
one: every property this package declares with a value anywhere in
`styles.css` is part of this package's public API, readable directly by a
host, not only overridable.

Before `0.4.0`, a small set of pre-`0.2.0` names (`--vscode-*`,
`--checkbox-border`, `--editor-brand`) carried the real defaults, and every
`--liminis-editor-*` name was itself only a forward to one of them. That
direction is now reversed: those legacy names are deprecated shims —
`<legacy-name>: var(--liminis-editor-x);` — read by nothing inside this
package, kept only so a host that still *sets* one of them keeps working.
That works by ordinary CSS cascade precedence, not because this package
reads the shim back: a host's own `:root`/`.dark` declaration of, say,
`--vscode-foreground` wins over this package's shim declaration of the same
property, and every internal consumption site reads
`--liminis-editor-foreground` directly, so the host's override reaches the
editor without this package needing to read the legacy name at all. This is
verified with `getComputedStyle` in a running Electron shell
(`examples/electron/e2e/theming-aliases.spec.ts`), not assumed from cascade
theory alone. The pre-`0.2.0` `--slashmd-*` names have no shim at all — they
are deleted outright, verified unread by any known consumer (ADR-98).

One package-owned exception: `--liminis-editor-primary`/`-100` and
`--liminis-editor-muted-foreground`/`-100` back the C4 diagram's
layout-toggle buttons, and `C4Component.tsx` checks liminis-app's own
`--color-primary`/`--color-muted-foreground` Tailwind tokens *first*,
falling back to this package's own default — so those four rows below are
documented under their `--color-*` names, not their `--liminis-editor-*`
names, even though the `--liminis-editor-*` declarations are just as real
(see ADR-98). This is the only place a non-`--liminis-editor-*` name is a
supported way to theme this package.

Renaming or removing a definition is a breaking change, the same as any
other change to a supported API surface described under "Versioning policy"
above — this package's CI guards against a definition disappearing
unintentionally (ADR-092).

**Previous name** is the pre-`0.2.0` name this property replaced — the exact
name to look for if you're migrating a host that still overrides the old
vocabulary (`—` for a property that was never renamed, including the four
`--color-*` rows above, which were never a `--liminis-editor-*` rename to
begin with). **Controls** is a short description of what the token actually
affects. **Kind** distinguishes tokens that only affect appearance
(`Cosmetic`) from the handful that also affect layout (`Structural` —
heading indents and the base font). **Has a default** marks tokens declared
with a value in `styles.css` directly; every `--liminis-editor-*` row below
reads "Yes" for that reason directly, not via an alias. The four `--color-*`
rows read "No (inline fallback only)" — they are liminis-app's own tokens,
never declared by this package, exactly as before this change.

This table is generated from `src/` by `node scripts/generate-theming-docs.mjs`
and checked for staleness in CI (`tests/theming-contract.test.ts`) — a `var(--x)`
added to the source without regenerating this block fails the build. Do not
hand-edit the rows between the markers below. See ADR-085 for how the
generation and drift guard work, ADR-087 for the original rename and its
compatibility design, ADR-092 for the separate guard that protects the full
*defined* set — every token declared with a value in `styles.css`, per the
checked-in baseline (`scripts/lib/theming-defined-tokens-baseline.json`) —
against an unintentional rename or removal (run `pnpm docs:theming-baseline`
after a deliberate one), and ADR-98 for the direction inversion this section
describes, superseding ADR-93.

<!-- theming-tokens:start -->
| Custom property | Previous name | Controls | Kind | Has a default |
| --- | --- | --- | --- | --- |
| `--color-muted-100` | — | liminis-app's own Tailwind brand token; when set, wins over --liminis-editor-muted-100 for the C4 diagram layout-toggle button's inactive background. | Cosmetic | No (inline fallback only) |
| `--color-muted-foreground` | — | liminis-app's own Tailwind brand token; when set, wins over --liminis-editor-muted-foreground for the C4 diagram layout-toggle button's inactive icon/text color. | Cosmetic | No (inline fallback only) |
| `--color-primary` | — | liminis-app's own Tailwind brand token; when set, wins over --liminis-editor-primary for the C4 diagram layout-toggle button's active icon/text color. | Cosmetic | No (inline fallback only) |
| `--color-primary-100` | — | liminis-app's own Tailwind brand token; when set, wins over --liminis-editor-primary-100 for the C4 diagram layout-toggle button's active background. | Cosmetic | No (inline fallback only) |
| `--liminis-editor-background` | `--vscode-background` | Base background color of the editor surface and its popovers/menus. | Cosmetic | Yes |
| `--liminis-editor-bold-color` | `--slashmd-bold-color` | Text color of bold (`**text**`) markdown spans. | Cosmetic | Yes |
| `--liminis-editor-border` | `--vscode-border` | Default border color used throughout the editor chrome. | Cosmetic | Yes |
| `--liminis-editor-button-background` | `--vscode-button-background` | Background of primary action buttons (e.g. the correction panel's "Apply" button). | Cosmetic | Yes |
| `--liminis-editor-button-foreground` | `--vscode-button-foreground` | Text color of primary action buttons. | Cosmetic | Yes |
| `--liminis-editor-callout-caution-bg` | `--slashmd-callout-caution-bg` | Background of "caution" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-caution-border` | `--slashmd-callout-caution-border` | Left border accent of "caution" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-important-bg` | `--slashmd-callout-important-bg` | Background of "important" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-important-border` | `--slashmd-callout-important-border` | Left border accent of "important" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-note-bg` | `--slashmd-callout-note-bg` | Background of "note" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-note-border` | `--slashmd-callout-note-border` | Left border accent of "note" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-tip-bg` | `--slashmd-callout-tip-bg` | Background of "tip" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-tip-border` | `--slashmd-callout-tip-border` | Left border accent of "tip" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-warning-bg` | `--slashmd-callout-warning-bg` | Background of "warning" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-callout-warning-border` | `--slashmd-callout-warning-border` | Left border accent of "warning" callout blocks. | Cosmetic | Yes |
| `--liminis-editor-checkbox-border` | `--checkbox-border` | Border color of unchecked task-list checkboxes. | Cosmetic | Yes |
| `--liminis-editor-code-bg` | `--vscode-code-bg` | Background of inline code spans and fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-errorForeground` | `--vscode-errorForeground` | Text color for error and validation messages. | Cosmetic | Yes |
| `--liminis-editor-external-link` | `--vscode-external-link` | Text color of links that point outside the document. | Cosmetic | Yes |
| `--liminis-editor-focus-border` | `--vscode-focus-border` | Border color of the toolbar link-input field when focused. | Cosmetic | Yes |
| `--liminis-editor-focusBorder` | `--vscode-focusBorder` | Color of the drag-and-drop position indicator while reordering blocks. | Cosmetic | Yes |
| `--liminis-editor-font-family` | `--vscode-font-family` | Base font family for the editor content. | Structural | Yes |
| `--liminis-editor-font-size` | `--vscode-font-size` | Base font size for the editor content. | Structural | Yes |
| `--liminis-editor-foreground` | `--vscode-foreground` | Default text color throughout the editor. | Cosmetic | Yes |
| `--liminis-editor-foreground-muted` | `--vscode-foreground-muted` | Hover border color for the frontmatter tray's raw-view toggle. | Cosmetic | Yes |
| `--liminis-editor-h1-color` | `--slashmd-h1-color` | Text color of level-1 (`#`) headings. | Cosmetic | Yes |
| `--liminis-editor-h1-indent` | `--slashmd-h1-indent` | Left margin of level-1 (`#`) headings. | Structural | Yes |
| `--liminis-editor-h2-color` | `--slashmd-h2-color` | Text color of level-2 (`##`) headings. | Cosmetic | Yes |
| `--liminis-editor-h2-indent` | `--slashmd-h2-indent` | Left margin of level-2 (`##`) headings. | Structural | Yes |
| `--liminis-editor-h3-color` | `--slashmd-h3-color` | Text color of level-3 (`###`) headings. | Cosmetic | Yes |
| `--liminis-editor-h3-indent` | `--slashmd-h3-indent` | Left margin of level-3 (`###`) headings. | Structural | Yes |
| `--liminis-editor-h4-color` | `--slashmd-h4-color` | Text color of level-4 (`####`) headings. | Cosmetic | Yes |
| `--liminis-editor-h4-indent` | `--slashmd-h4-indent` | Left margin of level-4 (`####`) headings. | Structural | Yes |
| `--liminis-editor-h5-color` | `--slashmd-h5-color` | Text color of level-5 (`#####`) headings. | Cosmetic | Yes |
| `--liminis-editor-h5-indent` | `--slashmd-h5-indent` | Left margin of level-5 (`#####`) headings. | Structural | Yes |
| `--liminis-editor-input-bg` | `--vscode-input-bg` | Background of the toolbar link-input field. | Cosmetic | Yes |
| `--liminis-editor-inputValidation-errorBackground` | `--vscode-inputValidation-errorBackground` | Background of inline validation-error messages. | Cosmetic | Yes |
| `--liminis-editor-italic-color` | `--slashmd-italic-color` | Text color of italic (`*text*`) markdown spans. | Cosmetic | Yes |
| `--liminis-editor-link` | `--vscode-link` | Text color of in-document links. | Cosmetic | Yes |
| `--liminis-editor-menu-background` | `--vscode-menu-background` | Background of context menus (block, selection and correction menus). | Cosmetic | Yes |
| `--liminis-editor-menu-border` | `--vscode-menu-border` | Border color of context menus. | Cosmetic | Yes |
| `--liminis-editor-menu-foreground` | `--vscode-menu-foreground` | Text color of context menu items. | Cosmetic | Yes |
| `--liminis-editor-menu-selectionBackground` | `--vscode-menu-selectionBackground` | Background of a hovered/selected context menu item. | Cosmetic | Yes |
| `--liminis-editor-menu-separatorBackground` | `--vscode-menu-separatorBackground` | Color of separator lines inside context menus. | Cosmetic | Yes |
| `--liminis-editor-notificationsInfoIcon-foreground` | `--vscode-notificationsInfoIcon-foreground` | Color of informational icons in inline notifications. | Cosmetic | Yes |
| `--liminis-editor-selection` | `--vscode-selection` | Background color of selected/highlighted text. | Cosmetic | Yes |
| `--liminis-editor-token-comment` | `--slashmd-token-comment` | Syntax-highlight color for comments in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-function` | `--slashmd-token-function` | Syntax-highlight color for function names in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-keyword` | `--slashmd-token-keyword` | Syntax-highlight color for keywords in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-operator` | `--slashmd-token-operator` | Syntax-highlight color for operators in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-property` | `--slashmd-token-property` | Syntax-highlight color for object properties in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-punctuation` | `--slashmd-token-punctuation` | Syntax-highlight color for punctuation in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-selector` | `--slashmd-token-selector` | Syntax-highlight color for CSS selectors in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-token-variable` | `--slashmd-token-variable` | Syntax-highlight color for variables in fenced code blocks. | Cosmetic | Yes |
| `--liminis-editor-toolbar-hoverBackground` | `--vscode-toolbar-hoverBackground` | Background of a toolbar button on hover. | Cosmetic | Yes |
<!-- theming-tokens:end -->

**A worked example.** To match a host's own palette, override a subset of
tokens after importing `styles.css` — no rebuild of the editor required:

```css
@import '@liminis/editor/styles.css';

:root {
  --liminis-editor-foreground: #1a1a2e;
  --liminis-editor-border: #d0d0e0;
  --liminis-editor-link: #4b3fce;
  --liminis-editor-code-bg: #f4f4fb;
}

.dark {
  --liminis-editor-foreground: #eaeaf5;
  --liminis-editor-border: #3a3a55;
  --liminis-editor-link: #9d90ff;
  --liminis-editor-code-bg: #1e1e2e;
}
```

Only the tokens you override need to change — everything else keeps the
package default. `--liminis-editor-foreground` and `--liminis-editor-border`
are the two most widely referenced tokens, so they're usually the
highest-value place to start.

#### Migrating from the old names

Before `0.2.0`, these tokens were split across four inconsistent prefixes:
`--vscode-*`, `--slashmd-*`, `--color-*` and `--checkbox-*`. `0.2.0` renamed
all of them to `--liminis-editor-*`, and **a host that still only supplies
an old name keeps working unchanged** — but as of `0.4.0` (ADR-98), that
guarantee works differently than it used to. It is no longer a consumption
-site fallback (`var(--liminis-editor-x, var(--old-name-x))`); it is a
`:root`-scoped shim declaration, `--old-name-x: var(--liminis-editor-x);`,
that this package never itself reads. A host's own override of the old name
still wins by ordinary cascade precedence, exactly as before — only the
mechanism producing that guarantee has changed, not the guarantee itself.
`--slashmd-*` is the one prefix with no shim at all: it is deleted outright
in `0.4.0`, verified unread by any known consumer (ADR-98) — a host that
somehow still relies on a `--slashmd-*` override should migrate to the
corresponding `--liminis-editor-*` name before upgrading.

The old prefixes are deprecated and will be removed in a future major
release; migrate at your own pace using the table above's **Previous name**
column, which lists each renamed property's exact old name — the mapping
isn't always a mechanical prefix swap (`--checkbox-border` became
`--liminis-editor-checkbox-border`, not `--liminis-editor-border`, to avoid
colliding with `--vscode-border`'s new name), so look it up rather than
deriving it.

Reading, not just overriding, is also migratable, and is the direction
`0.4.0` actually improves: before ADR-98, a host reading a legacy name
directly (e.g. mapping its own design tokens onto `--vscode-foreground`)
could switch that read to `--liminis-editor-foreground` only as long as
nothing (host or package) set the new name — some `--liminis-editor-*`
aliases forwarded to a token this package never defined at all
(`--liminis-editor-primary`, notably, forwarded to liminis-app's
`--color-primary` and baked a literal, `#3b82f6`, whenever liminis-app
hadn't set it), so switching a read to those names would return a value
this package didn't actually own. As of `0.4.0`, every `--liminis-editor-*`
name carries its own real, package-owned default — read migration is now a
like-for-like swap with no caveat, for every name except
`--liminis-editor-primary`/`-100`, whose default value deliberately changed
(see verveguy/zusammen#134, the migration this addresses, and ADR-98 for why
the old value was a defect, not a default worth preserving).

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

The registry is the normal route (`pnpm add @liminis/editor`). The
**packed tarball** below remains the way to consume an unreleased change — a
local build, or a commit that has not been tagged:

```bash
# in this repository
pnpm build && pnpm pack --pack-destination /tmp

# in the consuming application
pnpm add /tmp/liminis-editor-0.1.0.tgz
```

Applications that do this commit the tarball into their own tree (typically under
`vendor/`) and pin it by filename, so the install is reproducible and pinned to
an exact build. `pnpm pack` is unaffected by the publish guard — that guard runs
from `prepublishOnly`, so packing, installing and vendoring all work normally
while publishing stays a deliberate act.

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
entry points, so it breaks when an adopter would break. Its content is a picker
over the same round-trip fixture corpus the package's own test suite uses, so
every fixture-representable node class renders somewhere in it. See
[`examples/demo/README.md`](./examples/demo/README.md).

`examples/demo` is also the source of the public GitHub Pages site: a
`release`-triggered (not merge-triggered) build of this same shell, showing a
visible version badge for the published release it represents and a
Documentation tab rendering this README. Between releases the deployed site
stays on the last published version even as `main` keeps moving — that
staleness is intentional, not a bug (see `docs/decisions/adr-082.md`).

## Electron e2e shell

`examples/electron/` is a minimal Electron host for the package — a window, the
editor, and stubbed host services, no more — that a Playwright e2e suite drives
over CDP against real Chromium/Electron rather than a jsdom-class test
environment. It exists so package-level e2e can catch defects that only ever
surface in a real browser without needing `liminis-app`, or any other downstream
application, to exist. See
[`examples/electron/README.md`](./examples/electron/README.md).

```bash
pnpm build:examples   # builds and packs the package once, then builds both
                       # examples/demo and examples/electron against it
pnpm build:site       # builds examples/demo only — what the release-triggered
                       # Pages deploy runs (see the Demo section above)
```

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

## Acknowledgements

This editor began as the `webview-ui` package of
[**SlashMD**](https://github.com/wolfdavo/SlashMD) by David Wolfenden (MIT, as
declared in that project's README) — a VS Code extension that opens Markdown
files in a block-based WYSIWYG editor while keeping the file itself plain
Markdown.

That is the origin of the substance of this package, not a passing influence:
the Lexical node set (callouts, toggles, equations, Mermaid, frontmatter,
images), the mdast ↔ Lexical mappers, the Markdown parsing and stringification
layer, and the host-message contract all descend from it. The contract's shape
still shows its beginnings — `REQUEST_INIT`, `REQUEST_SETTINGS`, `WRITE_ASSET`
were a VS Code webview protocol before they were carried over an Electron IPC
bridge — and identifiers such as `SlashMDSettings` keep the name outright.

What has changed since is the seam rather than the ideas: a curated set of
export subpaths, peer-dependency inversion, an annotation mechanism, and a
round-trip corpus that holds the Markdown pipeline to a fixed point.

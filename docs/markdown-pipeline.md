# The markdown pipeline

Markdown ↔ mdast ↔ Lexical, usable with or without an editor mounted.

```text
markdown text  ──parseMarkdown──▶  mdast Root  ──importMarkdownToLexical──▶  Lexical
markdown text  ◀─stringifyMarkdown──  mdast Root  ◀──exportLexicalToMdast──  Lexical
```

Everything on the mdast side is available from `@liminis/editor/markdown`,
which has no React, no Lexical, no DOM and no MathJax in its graph. The
Lexical mappers live on the root entry, because they need Lexical.

## `parseMarkdown`

```ts
import { parseMarkdown } from '@liminis/editor/markdown'

const { root } = parseMarkdown(text)
```

`root` is a standard mdast `Root`. Extensions enabled: GFM (tables, strikethrough,
task lists, autolinks), footnotes, math, definition lists, YAML frontmatter, and
wiki-links.

Beyond the standard extensions, `parseMarkdown` runs several post-passes that
exist to preserve information a plain mdast parse throws away:

- **Task lists in ordered lists.** GFM only supports checkboxes in unordered
  lists; Foam and Obsidian use them in ordered lists too, so they are added back.
- **Emphasis marker annotation.** Whether the source wrote `*em*` or `_em_` is
  recorded on the node, so a round trip does not silently rewrite one into the
  other.
- **Wiki-link pipe protection.** See below.
- **Empty-alias marking.** `[[target|]]` is distinguishable from `[[target]]`.

### Type guards

The entry exports guards for the mdast node types you will actually branch on:
`isParagraph`, `isHeading`, `isList`, `isListItem`, `isBlockquote`, `isCode`,
`isThematicBreak`, `isTable`, `isImage`, `isLink`, `isHtml`, `isText`,
`isStrong`, `isEmphasis`, `isInlineCode`, `isDelete`.

```ts
import { parseMarkdown, isHeading, isText } from '@liminis/editor/markdown'

const { root } = parseMarkdown(text)
const titles = root.children.filter(isHeading).map((h) => h.children.filter(isText).map(t => t.value).join(''))
```

`getFileType(path)` is also here — the editor's own file-type classifier.

## `stringifyMarkdown`

```ts
import { stringifyMarkdown } from '@liminis/editor'

const text = stringifyMarkdown(root, { bulletStyle: '-', fenceStyle: '`' })
```

| Option | Type | Default |
|---|---|---|
| `wrapWidth` | `number` | no wrapping |
| `bulletStyle` | `'-' \| '*' \| '+'` | `'-'` |
| `fenceStyle` | `` '`' \| '~' `` | `` '`' `` |

Serialization is written to keep a document byte-stable across a round trip
wherever markdown permits it. The most consequential piece is **list spread**:
whether a list is "loose" (blank lines between items) is carried through the
Lexical round trip and is only ever *upgraded* to loose, never downgraded — a
downgrade silently collapses blank lines and, on re-parse, misreads item
boundaries.

## The Lexical mappers

```ts
import { importMarkdownToLexical, exportLexicalToMdast } from '@liminis/editor'
```

These are what `<Editor>` uses internally. Reach for them directly only if you
are driving a Lexical editor yourself.

### Building a headless editor

The mapper functions instantiate Lexical node classes directly, so a
`createEditor` you build yourself must be configured with the *exact* node set
`<Editor>` uses — any node type Lexical encounters that isn't registered
throws. `@liminis/editor/nodes` exports that array (`editorNodes`) alongside
the two mapper functions, without pulling in `<Editor>`/`<App>`, Mermaid, or
Prism. This is the entry point to use for a fast round-trip regression test
that exercises the real mapper without mounting a React component:

```ts
import { createEditor } from 'lexical'
import { editorNodes, importMarkdownToLexical, exportLexicalToMdast } from '@liminis/editor/nodes'
import { parseMarkdown } from '@liminis/editor/markdown'

const editor = createEditor({
  namespace: 'headless',
  nodes: editorNodes,
  onError: (error) => { throw error },
})

const parsed = parseMarkdown(markdownSource)

// `importMarkdownToLexical` schedules its own `editor.update()`, which by
// default reconciles on a microtask. Wrap it in a `discrete: true` update so
// the mutation is committed before `exportLexicalToMdast` reads it back.
editor.update(() => {
  importMarkdownToLexical(editor, parsed.root)
}, { discrete: true })

const mdast = exportLexicalToMdast(editor)
```

`editorNodes` is the same array `<Editor>` configures its own `LexicalComposer`
with — not a separately maintained copy — so a node type added to the
production editor is reflected here automatically. `EquationNode` imports
MathJax's lite adaptor at module scope, so loading `./nodes` carries the same
documented MathJax-lite exception as `./headless`; it does not initialize
Mermaid, C4's layout engine, or Prism, since those node classes lazy-load their
render components.

## Wiki-links

Wiki-links are `[[target]]` or `[[target|alias]]` (Obsidian/Foam style — the
alias divider is `|`, not the upstream default `:`). They parse to a `wikiLink`
mdast node:

```ts
{ type: 'wikiLink', value: 'target', data: { alias, permalink, exists, /* hast shim fields */ } }
```

`data.alias` is the display text — it falls back to the target when no explicit
alias is given, which is upstream behaviour and occasionally surprising.

### The pipe-in-tables problem (#347)

A pipe inside a table cell terminates the cell. An aliased wiki-link in a table
therefore has to escape its divider (`[[target\|alias]]`) or GFM parsing splits
the link — and, worse, corrupts the shape of the whole table row.

`parseMarkdown` escapes the divider before parsing and the wiki-link extension
strips the resulting backslash off the target afterwards. The strip happens
*before* the target is resolved, so `data.permalink` and `data.exists` are
computed from the clean target.

This behaviour originally came from a `pnpm patch` on the npm package. That
patch could not travel outside the Liminis monorepo, so the extension is now
**vendored** into this package (MIT, from
[`landakram/mdast-util-wiki-link`](https://github.com/landakram/mdast-util-wiki-link);
license and modifications ship at `dist/markdown/vendor/mdast-util-wiki-link/`).

**If you are maintaining this package: do not remove the trailing-backslash
strip.** It looks like a stray special case. It is the fix for
[#347](https://github.com/verveguy/liminis/issues/347), and removing it breaks
entire markdown tables that happen to contain an aliased wiki-link, not just the
link.

### Building your own pipeline

If you need an mdast pipeline of your own that agrees with the editor's — a
chunker, an indexer, an exporter — take the wiki-link extension from this
package rather than from npm, or your parse will differ from the editor's:

```ts
import { fromMarkdown } from 'mdast-util-from-markdown'
import { syntax as wikiLinkSyntax } from 'micromark-extension-wiki-link'
import { wikiLinkFromMarkdown, wikiLinkToMarkdown } from '@liminis/editor/markdown'

const OPTIONS = { aliasDivider: '|' }

const tree = fromMarkdown(text, {
  extensions: [wikiLinkSyntax(OPTIONS) /* , gfm(), … */],
  mdastExtensions: [wikiLinkFromMarkdown(OPTIONS) /* , gfmFromMarkdown(), … */],
})
```

`wikiLinkToMarkdown` is the matching serializer extension, built on
`mdast-util-to-markdown` v2.

> **The extensions alone are not equivalent to `parseMarkdown`.** If you enable
> GFM tables alongside them, prefer `parseMarkdown` — see below.

### What the extensions do *not* give you

`parseMarkdown` is more than these two extensions, and the difference is not
cosmetic. Two pre/post-passes live in `parseMarkdown` and have no equivalent
inside the extension:

- **Alias-pipe escaping (the #347 fix above).** The trailing-backslash strip in
  `wikiLinkFromMarkdown` only helps once the divider is *already* escaped.
  `parseMarkdown` does that escaping before parsing. Without it, GFM's table
  parser reaches the `|` first. Measured on `| [[target\|alias]] | x |` in a
  two-column table: the extensions alone yield **5 table cells and 0 wiki-link
  nodes** — the row is corrupted and the link is gone — where `parseMarkdown`
  yields 4 cells and 1 wiki-link.
- **Empty-alias preservation.** `[[target|]]` is distinguishable from
  `[[target]]` only because `parseMarkdown` substitutes a sentinel before parsing
  and sets `data._emptyAlias` after. The extensions alone produce no wiki-link
  node at all for that input.

So: **if your pipeline enables GFM tables, or you care about `[[target|]]`, call
`parseMarkdown` rather than assembling the extensions yourself.** Reach for the
raw extensions only when you control the input and neither case applies.

Note also that `<Editor>`'s own *serialization* does not go through
`wikiLinkToMarkdown`: `stringifyMarkdown` carries a hand-rolled wiki-link handler
that additionally understands `data._emptyAlias`. `wikiLinkToMarkdown` is the
faithful vendored upstream serializer, not a byte-for-byte match for what the
editor emits.

## Wiki-link promotion on export

Everything above is about *parsing* `[[target]]` syntax the author already wrote.
Independently, `exportLexicalToMdast` (in `lexicalToMdast.ts`) also *produces*
wiki-link syntax on export, for a link the author wrote as an ordinary standard
markdown link: `convertLinkNode` promotes any **untitled** link whose URL looks
like a relative note reference — a relative `.md` path (with or without a
leading `./`/`../`), a `.md` path with an anchor, a bare `#anchor`, or a
directory-style (trailing-slash) path (see `isWikiLinkUrl`) — into `[[target]]`
/ `[[target|alias]]` on export. A **titled** link (`[text](url "title")`) is
never promoted, regardless of URL shape — wiki-link syntax has no slot for a
title, so promoting one would silently drop it
([#919](https://github.com/verveguy/liminis/issues/919)).

This is deliberate for `liminis-app`, whose documents are wiki-link-native: a
relative link to another note *is* a wiki-link, and round-tripping it as one is
correct. It is not correct for every consumer — a host whose documents are
plain markdown rendered somewhere that doesn't understand `[[...]]` syntax
(e.g. the GitHub web UI) would see every untitled relative link rewritten into
non-rendering syntax on save, which is document corruption from that
consumer's point of view, not a normalization
([#951](https://github.com/verveguy/liminis/issues/951)).

### The `wikiLinkPromotion` option

`exportLexicalToMdast(editor, options)` accepts an optional `ExportOptions`
object with a `wikiLinkPromotion?: 'promote' | 'off'` field, defaulting to
`'promote'` — today's only behavior, unchanged for any caller that doesn't set
it. `'off'` disables promotion of an *ordinary* standard-markdown link whose
URL merely looks wiki-link-shaped: it is emitted as a standard markdown link
instead of `[[target]]`. It does not affect a link that was genuine,
author-written `[[target]]` / `[[target|alias]]` wiki-link syntax in the
source — that always round-trips back out as a wiki-link, regardless of this
setting, so an opted-out host still never corrupts a document's existing
wiki-links, only stops creating new ones. (The two are distinguished by
provenance, tracked on the parsed link node — not by re-inspecting the URL,
which is identical either way.) This does not change which URLs
`isWikiLinkUrl` classifies as wiki-link-like, and it has no effect on
*parsing* — a genuine, author-written `[[target]]` in the source still parses
to a link node on import regardless of this setting.

Both types are exported from the root barrel (`@liminis/editor`), alongside
`exportLexicalToMdast` itself:

```ts
import { exportLexicalToMdast, type ExportOptions, type WikiLinkPromotionMode } from '@liminis/editor'

const mdast = exportLexicalToMdast(editor, { wikiLinkPromotion: 'off' })
```

The `<Editor>`/`<App>` component surface exposes the same setting as an
optional `wikiLinkPromotion` prop, mirroring the existing `imagePathResolution`
prop's shape (though sourced differently — see below):

```tsx
<App wikiLinkPromotion="off" ... />
```

Unlike `imagePathResolution` (which `<App>` derives from IPC-delivered
`SlashMDSettings`), `wikiLinkPromotion` is a direct `AppProps` field, not
settings-derived: `<App>` also supports a non-IPC "inline" mode (`content`/
`onChange` props, bypassing the host-message channel entirely), where
`settings` stays `null` forever — a settings-only path would be unreachable by
a host running that way, which is exactly the shape the option was added for.

The setting also reaches the annotation-anchor-capture export path
(`annotation-marks.ts`), not just the disk-write path: both are expected to
agree on whether a link's raw-markdown form is wiki-link or standard syntax, so
an opted-out host's annotation anchors are captured against the same link
syntax its saved document actually contains.

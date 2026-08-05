# The markdown pipeline

Markdown ↔ mdast ↔ Lexical, usable with or without an editor mounted.

```
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

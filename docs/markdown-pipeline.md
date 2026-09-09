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
- **Transclusion/embed detection (`![[target]]`, #119).** The `!`-prefixed form
  is recognized only by `parseMarkdown`'s own embed-sentinel pre/post-processing
  (see below) — the raw extensions have no concept of it at all. A `!` before a
  raw-extension `[[...]]` is just ordinary preceding text; the extensions never
  produce a `wikiEmbed` node. `data.blockId` on a plain `wikiLink` node *is*
  available through the raw extensions (it's pure token-value splitting inside
  the vendored `mdast-util-wiki-link`, not pipeline-level surgery) — only the
  embed marker itself is main-pipeline-only.

So: **if your pipeline enables GFM tables, cares about `[[target|]]`, or needs
`![[target#^id]]` transclusion detection, call `parseMarkdown` rather than
assembling the extensions yourself.** Reach for the raw extensions only when
you control the input and none of those cases apply.

Note also that `<Editor>`'s own *serialization* does not go through
`wikiLinkToMarkdown`: `stringifyMarkdown` carries a hand-rolled wiki-link handler
that additionally understands `data._emptyAlias` and `wikiEmbed` nodes.
`wikiLinkToMarkdown` is the faithful vendored upstream serializer (extended with
`data.blockId` re-appending, see below), not a byte-for-byte match for what the
editor emits.

## Block-scoped links and transclusion (#119)

`[[file#^id]]` is a block-scoped link — the same `[[...]]` construct as
above, extended with an optional `#^blockId` fragment (Obsidian's
block-reference convention: a caret immediately after the `#`). It parses to
the same `wikiLink` node shape, with `data.blockId` set:

```ts
{ type: 'wikiLink', value: 'file', data: { alias, permalink, exists, blockId: 'id', /* … */ } }
```

An ordinary heading anchor (`[[file#heading]]`, no caret) is untouched —
`data.blockId` is only ever set for the caret-prefixed form, so this is
purely additive to the existing anchor-link behavior described elsewhere in
this document.

`![[file#^id]]` — the same target+id addressing, `!`-prefixed — is
**transclusion**: a live, resolver-driven rendering of that block's current
content in place of the reference, not a link. It parses to a distinct
`wikiEmbed` node, not a `wikiLink` with a flag:

```ts
{ type: 'wikiEmbed', value: 'file', data: { alias, blockId: 'id', /* … */ } }
```

`![[file]]` with no `#^id` fragment (whole-file transclusion) is not a
supported construct — the parser leaves it as an ordinary `[[file]]` link
(no embedding), never a `wikiEmbed`.

### Why `wikiEmbed` is a separate node type, not a field on `wikiLink`

Every existing `wikiLink` consumer — including this repository's own
mdast↔Lexical mappers — is untouched by this addition. `[[file#^id]]` (link)
and `![[file#^id]]` (embed) are trivially distinguishable by `node.type` for
any downstream consumer, rather than requiring a new-field check added to
code that predates this feature.

### How the embed marker is detected without a second vendored tokenizer

`micromark-extension-wiki-link` (unvendored, straight from npm) hooks only
the `[` character, with no `!`-prefix awareness. A literal `!` immediately
before `[[` is claimed *first* by the default CommonMark image-label-start
construct; when that construct fails to find a following `(url)`/`[ref]`
(which it always does for `[[target]]` — that isn't image syntax), bracket
resolution falls the *entire* `![[target]]` span back to one literal text
node, without the wiki-link tokenizer ever getting a chance to fire on the
inner `[[`.

Rather than vendoring a second tokenizer package to add `!`-prefix detection
(the LICENSE/provenance/parity-test burden this repository already paid once
for #347's `mdast-util-wiki-link` fix), `parseMarkdown` swaps a `!` for a
Private-Use-Area sentinel codepoint *before* parsing — but only when it is
immediately followed by a complete, single-line `[[...]]` span with no
internal `]`, exactly the grammar the tokenizer's own target/alias states
require to succeed. That condition is load-bearing, not incidental: a naive
"any `!` before `[[`" substitution collides with a real image whose alt text
starts with a literal bracket (`![[leading] bracket](img.png)` contains the
raw substring `![[`), and would prevent the image construct — which needs
the literal `!` — from ever being tried.

After parsing, a post-process retypes a sentinel-preceded `wikiLink` node to
`wikiEmbed` only when it carries a `blockId`; otherwise the literal `!` is
restored and the node stays an ordinary `wikiLink` (`![[file]]` with no id
degrades to a plain link, per the "not a supported construct" rule above).
The swap is one codepoint for one codepoint, so it needs no offset-remapping
the way the pipe-escaping/empty-alias-normalization pre-passes above do.

**If you are maintaining this package: do not remove or loosen the
"complete span, no internal `]`" condition on the embed-marker substitution
in `parse.ts`.** It looks like it could be simplified to a bare
`!(?=\[\[)` lookahead. Doing so silently corrupts any image whose alt text
starts with a bracketed span — caught before merge by the
`903-image-alt-leading-bracket` round-trip fixture, which is the regression
gate for this specific failure mode.

### The transclusion resolver

`![[file#^id]]` renders the resolved block's live content via an optional
host-injected `resolveTransclusion(file, blockId) => Promise<string | null>`
(see `docs/editor-api.md`), consumed by a lazily-loaded component — not at
mapper time, since resolution is async and `mdastToLexical`/`lexicalToMdast`
are synchronous. With no resolver injected, or one that returns `null`, the
transclusion renders a clearly marked "unresolved" placeholder rather than
throwing or rendering nothing.

**If you are maintaining this package: do not remove the cycle/depth guard**
in `src/app/editor/nodes/transclusion-render.tsx`. A transclusion cycle (A
embeds B, B embeds A — directly, or transitively through a longer chain) is
guarded by a per-branch visited-path of `file#^blockId` keys, and nested
transclusion is bounded to a depth of 8, both checked *before* the resolver
is called at each level. Removing either turns an authoring mistake into an
infinite loop or unbounded recursion instead of a contained "circular
transclusion"/"nested too deeply" indicator.

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

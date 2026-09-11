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

## Block anchor badges (#122, widened by #124 and #127)

A block anchor — a bare `^ULID` at its *definition* site, most commonly
trailing an action-item checkbox (`- [ ] ... ^01M00VDX0S4JHMDNA7F776Y8R8`) —
renders as a compact badge instead of the raw caret-plus-id text. This is
presentation only: the underlying markdown, and the id itself, never change.
It has no relationship to the `#^blockId` fragment inside `[[file#^id]]`
above other than sharing a source convention — this section is about the
anchor's own definition site, not a link's target.

### `blockAnchor` is a new mdast node type, detected by a post-parse text split

```ts
{ type: 'blockAnchor', id: '01M00VDX0S4JHMDNA7F776Y8R8' }
```

Unlike the embed marker (`![[...]]`), a bare `^ULID` needs no tokenizer
unlock — there is no bracket syntax to let through. Detection is therefore a
**post-parse** pass (`splitTextNodeBlockAnchors`/`splitBlockAnchors` in
`parse.ts`) walking already-typed mdast `text` nodes and splitting a matching
run into its own `blockAnchor` node, mirroring `#17`'s
`splitTextNodeEscapes`/`splitEscapedPunctuation` (including its decode-replay
position-mapping machinery and the same conservative bail-out: if a text
node's replayed decoding doesn't exactly reproduce `node.value` — e.g. a
character reference is present — the whole run is left unsplit rather than
risk a wrong split).

Because this only ever inspects a `text` node's own `value`, it structurally
cannot see into `inlineCode`, `code`, `inlineMath`, `wikiLink` or `wikiEmbed`
node content — none of those are `text` nodes once mdast has typed them —
which satisfies the code-span/fenced-code/math edge case and FR-006 for free,
with no "protected ranges" pre-parse machinery required (unlike
`substituteEmbedMarker` above, which needs that machinery only because it has
to influence tokenization itself).

The matcher also rejects a match whose leading `^` came from a backslash
escape (`\^`) in the source, using the same `replayDecodeEscapes` output the
decode-replay machinery above already computes. Without this check, an
author who deliberately wrote `\^` before a ULID-shaped run to mean literal
text — not an anchor — would still get a badge, and since the `blockAnchor`
stringify handler always emits a bare, unescaped `^id`, saving would silently
drop their backslash. This does not repair the pre-existing, unrelated gap
that `^` sits outside `FORCE_ESCAPE_CHARS`: a bare `\^` with no adjacent
ULID-shaped run still loses its backslash on round-trip today, anchor or
not — see ADR-122's accepted limitations.

The pass runs in `parseMarkdown`'s post-process sequence after
`resolveWikiEmbeds`/`annotateEmphasisMarkers` — so it never sees wiki-link or
embed target text — and immediately before `splitEscapedPunctuation` (which
stays last), so that pass still sees, and can process, any escaped
punctuation left in the anchor split's "before"/"after" text siblings.

`stringify.ts`'s `blockAnchor` handler emits exactly `^` + the node's `id`,
with no escaping — lossless by construction, the same way `wikiLink`/
`wikiEmbed` are.

### The detection rule: one universal position rule, every id form alike (#124, #127, #126)

`findBlockAnchorMatches` in `parse.ts` applies a single rule at each
unescaped `^`, left to right: any id the resolver and the wiki-link
reference side already accept — ULID, raw-decimal snowflake ids, NanoID-style
ids with `_`/`-`, mixed-case base62, UUID-shaped hyphenated ids, short
alphanumeric ids — badges if and only if the caret starts a token (line-start
or preceded by whitespace) and the captured id (`WIDE_ID_CHAR`, the same
charset the wiki-link reference side and the resolver use) runs to end of
line. This is the resolver's own regex (`liminis-app/src/main/fs.ts`,
verveguy/liminis#1109) adopted verbatim, so badge and resolver agree by
construction rather than by coincidence, for every id form with no
carve-out. (At the time #124 shipped, `WIDE_ID_CHAR` was `[^\s\]#]+`; #127
later narrowed it to also exclude `*`, matching a further narrowing the
resolver itself picked up for `liminis#1114` — see below.)

**This was not always one rule.** #124 originally split detection into two
branches: ULID kept #122's original rule, unconstrained by position, while
every other id form was gated by the position rule above. That carve-out
existed because #122's own fixtures required a ULID to badge immediately
after a wiki-link/emphasis run with no preceding space, and required a ULID
followed by more prose on the same line to badge — shapes the resolver can
never address, since it only ever matches an anchor definition running to
end of line. #126 deleted the carve-out: those mid-line fixtures turned out
to encode parser-robustness tests, not a product requirement, because
production's actual mid-line ULID occurrences are wiki-link *references*
(`[[file#^id]]`), parsed position-independently and unaffected by this
change — not anchor *definitions*. A badged mid-line ULID was a promise
`[[file#^id]]` could never keep, the same "UI says X, system does Y"
disagreement #124 fixes, in the opposite direction. Deleting the carve-out
was a pure removal, not a rewrite: Crockford Base32 (ULID's charset) is
already a strict subset of the position rule's charset, so every ULID that
already satisfied the position rule — plain or emphasis-wrapped, at line
end — keeps badging unchanged; only mid-line ULIDs, and ULIDs immediately
adjacent to a preceding sibling with zero intervening whitespace, stopped
badging. See ADR-122's 2026-09-10 (#126) amendment for the full history,
including the rejected minimum-length threshold and the residual this left
(a caret with zero preceding whitespace, immediately after a wiki-link or
emphasis/strong sibling, can never badge at any line position — not just
mid-line).

Widening the charset without position-gating was, and remains, rejected:
`x^2`/`2^10`/`a ^ b` would badge as false positives, since nothing else
bounds an undelimited charset match the way `[[...]]` brackets bound the
wiki-link reference side's use of the same charset.

A shared, cross-repo case table
(`src/markdown/__tests__/blockAnchorCases.ts`, `BLOCK_ANCHOR_POSITION_CASES`)
pins this rule's id/position behavior against the resolver's actual, merged
`ANCHOR_LINE_PATTERN`, asserted in full by a single `it.each` in
`parse.test.ts` — so a future divergence between the two repositories' rules
fails a test instead of shipping as a live defect, the way both #124's and
#126's own gaps originally did.

The boundary checks may need to peek one character outside the current text
node's own source span — into the surrounding normalized document text, one
character before the node's start or from the node's end onward — since a
preceding/following sibling (e.g. a wiki-link) has no character of its own
for the matcher to inspect directly. This is equivalent to inspecting the
sibling node and needs no AST traversal to do it.

**A symmetric emphasis wrapper at line end (added by #127).**
`**^a1b2c3**`, `__^a1b2c3__`, `*^a1b2c3*` and `_^a1b2c3_` all badge
`a1b2c3` — matching `verveguy/liminis#1114`'s widened resolver, which
accepts the same wrapped shape.

When CommonMark parses `**^a1b2c3**` as real emphasis, the wrapper
characters are consumed into the *parent* `strong`/`emphasis` node's
position span — they never appear in the inner `text` node's own
`decoded`/`value`. That has a useful structural consequence: a caret can
only be adjacent to a *structural* wrapper marker when it is the first
character of its own text node (`i === 0`), and a closer only when the id
capture runs all the way to that same node's own end
(`idEnd === decoded.length`) — outside those two positions, whatever
wrapper-like characters are present are literal text left over from an
unmatched delimiter run, already correctly rejected by the plain rule with
no wrapper logic involved. Gating wrapper detection on both invariants
means the extension is just two more raw-character peeks into the
surrounding normalized text (`matchWrapperMarkerBefore` on the open side,
an exact-string check on the close side), the same style the plain
whitespace boundary above already uses — no need to pass the enclosing
`strong`/`emphasis` node's type, marker, or position down through the tree
walk.

The wrapped id charset (`WRAPPED_ID_CHAR`, `[^\s\]#*]`) matches the
resolver's actual wrapped-branch charset as implemented for `liminis#1114`
(`ANCHOR_LINE_PATTERN`'s `[^\s\]#*]+?` wrapped-id group) — it excludes `*`
but allows `_`, since `_` is a legitimate character in ids like
`V1StGXR8_Z5jdHi6B-myT` (NanoID) and `snake_case_id`. `WIDE_ID_CHAR` (the
unwrapped path) uses the same charset: the resolver's implemented pattern
narrowed *both* its wrapped and unwrapped branches to exclude `*`, not just
the wrapped one, so the two constants are currently identical — kept as
separate names since they're independent knobs in the resolver's pattern
that could diverge again. Neither excludes `_`: doing so would regress the
NanoID-with-underscore case (`^V1StGXR8_Z5jdHi6B-myT`, #124/FR-004), and the
resolver doesn't exclude it either.

The closer must be the *exact same marker string* that opened it — not an
independently optional match — so an asymmetric wrapper (`item **^<ULID>_`)
is rejected outright rather than captured with a corrupted id, ULID or not
(#126: there is no longer a position-free carve-out for it to fall back to).
Wrapper forms other than `**`/`__`/`*`/`_` — triple emphasis (`***…***`),
strikethrough (`~~…~~`), backtick-wrapped, and paren-wrapped — stay
unhandled by design: `WRAPPER_MARKERS` only lists the four forms
`liminis#1114`'s resolver pattern accepts. `squared *^2*` becomes a
badged-and-resolved false anchor as a result of this widening — accepted
deliberately, for the same reason a minimum-length floor was already
rejected for `^100` in #124 (excluding it would also exclude legitimate
short ids like `^a1b2c3`). See ADR-122's 2026-09-10 (#127) and 2026-09-10
(#126) amendments.

### The Lexical side: `BlockAnchorNode`, mirroring `FootnoteNode`

`BlockAnchorNode` (`src/app/editor/nodes/BlockAnchorNode.tsx`) is an inline
`DecoratorNode<JSX.Element>` carrying the id, a format bitmask, and
strong/emphasis marker fields — the same shape as `FootnoteNode`, so an
anchor sitting inside `**bold**`/`_italic_` still round-trips its original
marker style rather than silently dropping it (the defect class already
fixed once for other inline decorators, `#898`/`#908`). `BlockAnchorComponent`
renders the actual badge: the full id is exposed via the native `title`
tooltip on hover, and a click copies it via `navigator.clipboard.writeText`
with brief "Copied" feedback — mirroring `CodeBlockPlugin.tsx`'s existing
copy pattern, rather than a new interaction affordance (User Story 2/SC-003).

`convertInlineNode` (`mdastToLexical.ts`) maps a `blockAnchor` mdast node to
`$createBlockAnchorNode`; the reverse direction in `lexicalToMdast.ts` adds an
`$isBlockAnchorNode` branch at every site that already special-cases
`$isFootnoteNode` (`isHoistableConstruct`, `getMergeableFormat`,
`resolveMarkers`, and each content-conversion call site) so a `BlockAnchorNode`
participates in bold/italic wrapping, mark-boundary hoisting, and format
merging exactly like every other round-trip-sensitive inline construct.

**If you are maintaining this package: `convertListItemNode` keeps a
`BlockAnchorNode` inline, unlike an image/equation/footnote/inline-HTML
child of a list item** (a documented, pre-existing gap — see
`hoistedTokenReachesOutput`'s docstring in `lexicalToMdast.ts` — where those
constructs fall to the block dispatcher and do not survive a round trip
inline). `- [ ] ... ^ULID` is this feature's primary real-world shape, so
dropping a trailing anchor there would break the checkbox-action-item
pattern the spec calls out explicitly. Do not fold the `$isBlockAnchorNode`
branch back into the generic block-dispatch fallback.

### Round-trip contract

`parseMarkdown` → `stringifyMarkdown` reproduces a document containing block
anchors byte-identically (FR-002/SC-002), including inside a checkbox action
item, one space after a wiki-link or emphasis run, and inside bold/italic
text. A caret inside inline code, a fenced code block, or inline math is
never touched — it round-trips as plain literal text, since the post-parse
pass never sees inside those node types. A caret with *zero* preceding
whitespace immediately after a wiki-link or emphasis run also round-trips
byte-identically, but as plain text, not a `blockAnchor` node (#126: that
position can never satisfy the position rule, so it never badges — see the
detection-rule section above). See
`src/app/mapper/__tests__/fixtures/roundtrip/122-block-anchor/` for the
fixture corpus.

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

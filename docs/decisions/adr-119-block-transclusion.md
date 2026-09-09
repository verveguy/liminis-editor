# ADR-119: Block-Scoped Links and Transclusion Extend the Wiki-Link Construct, Not a Parallel Syntax

**Date:** 2026-09-08
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #119 (verveguy/liminis-editor)

## Context

Liminis (the host app) mints a stable `^ULID` on structured content —
overwhelmingly checkbox action items — to unify restated occurrences of the
same task and flip every one when it completes. Until this issue, that id
was inert as far as this package's markdown pipeline was concerned: no
parser, node type, or renderer understood it. The issue asks for two
Obsidian-style capabilities built on the existing `[[wikilink]]` construct
rather than a second bracket family: `[[file#^id]]` as a block-scoped link,
and `![[file#^id]]` as a live transclusion of that block's current content.

Research traced two load-bearing constraints before any design could
proceed:

1. **The micromark wiki-link tokenizer is external, unvendored, and has no
   `!`-prefix or `#`-fragment awareness.** `micromark-extension-wiki-link`
   hooks only the `[` character; a leading `!` is claimed first by the
   default image-label-start construct, and CommonMark's own bracket
   resolution falls the *entire* `![[target]]` span back to literal text
   when that construct fails to find `(url)`/`[ref]` — so the wiki-link
   tokenizer never even gets a chance to fire on the inner `[[`. Vendoring a
   second tokenizer package (mirroring how `mdast-util-wiki-link` was
   already vendored for #347) was the obvious fix and the most expensive
   one Research flagged: a new LICENSE/provenance trail, a second
   divergence log, and parity tests, for behavior that (unlike #347) is
   genuinely new syntax rather than a patch to existing behavior.
2. **A round-trip bug already lived on this issue's own headline example.**
   `mdastToLexical.ts` keeps a `.md` extension in the Lexical URL for an
   anchor-suffixed target (`notes.md#^01ABC`), but `lexicalToMdast.ts`
   unconditionally strips `.md#` back to `#` on export
   (`notes#^01ABC`) — not byte-identical to the input. Reusing the existing
   single-URL-string channel for the new block-id fragment would inherit
   this asymmetry on day one.

## Decision

**Extend `[[wikilink]]`, do not introduce a parallel bracket syntax**
(FR-001/FR-002), and land the tokenizer-level `!`-detection problem in
`parse.ts`'s existing text-level pre/post-processing layer instead of a
second vendored package.

### 1. A same-length sentinel substitution replaces vendoring a second tokenizer

Before parsing, `parse.ts` swaps a `!` for a Private-Use-Area codepoint
(`\u{E005}`, the next free slot after `annotate-sentinels.ts`'s E000–E003
and `stringify.ts`'s E004) — but **only** when it is immediately followed by
a complete, single-line `[[...]]` span containing no internal `]`. That
condition is not incidental: it is exactly the grammar
`micromark-extension-wiki-link`'s own `consumeTarget`/`consumeAlias` states
require to succeed (an un-doubled `]` or a line ending aborts the whole
construct). A naive `!(?=\[\[)` lookahead — tried first, and initially
shipped — collides with a real image whose alt text happens to start with a
literal bracket (`![[leading] bracket](img.png)` is `![` + alt text
`[leading] bracket` + `](img.png)`, containing the raw substring `![[`);
substituting there prevents the image construct (which needs the literal
`!`) from ever being tried. The `903-image-alt-leading-bracket` regression
fixture caught this before merge; the narrower pattern fixes it because the
run between `[[` and `]]` in that image hits a single `]` and never
completes.

After parsing, a post-process retypes a sentinel-preceded `wikiLink` node to
`wikiEmbed` **only when it carries a `blockId`**; otherwise it restores the
literal `!` (FR-013 — `![[file]]` with no anchor degrades to an ordinary
`[[file]]` link, not an embed, matching what a hand-typed `\![[file]]`
already does with no sentinel involved at all). Since the swap is one
codepoint for one codepoint, it needs no offset-remapping — unlike the
pipe-escaping/empty-alias-normalization steps already in this file, which
change length and do carry `Replacement` tracking.

### 2. `#^blockId` extraction lives in the vendored `mdast-util-wiki-link`, not in `parse.ts`

A trailing `#^blockId` fragment is split off `wikiLink.value` into
`data.blockId` inside the vendored `from-markdown.ts`, before
`pageResolver` runs (so `data.permalink`/`data.exists` are computed from
the file target alone) — and re-appended by `to-markdown.ts` on the way
out. This is pure token-value splitting, not pipeline-level text surgery,
so a raw `./markdown`-subpath consumer building their own pipeline gets
`data.blockId` for free. The `!`-prefixed embed marker does **not** get
this treatment: it stays main-`parseMarkdown`-pipeline-only, the same
asymmetry this package already accepts for empty-alias normalization and
pipe-escaping (see `docs/markdown-pipeline.md`).

### 3. File and blockId are separate fields everywhere, never folded into `url`/`value`

mdast carries `data.blockId` alongside `value` (the file target). Lexical
carries it as `CustomLinkNode.__blockId`, a field independent of `__url`.
This is not a style preference — it is what sidesteps the `.md#`-stripping
bug traced in Context without depending on that pre-existing bug being
fixed first, and it is what User Story 1 asks for directly ("a link
carrying both the file target and the block id" as identifiable data, not
an opaque combined string).

### 4. Transclusion is a new node type end-to-end: mdast `wikiEmbed`, Lexical `TransclusionNode`

Not a boolean field on `wikiLink`. Every existing `wikiLink` consumer
(including this repo's own mapper) is untouched — zero risk to FR-014 — at
the cost of the `./markdown`-parity gap already accepted in point 2.
`TransclusionNode` is an **inline** `DecoratorNode`, unlike block-level
`MermaidNode`: `wikiEmbed` is phrasing content (the same mdast family as
`wikiLink`/`image`), so this matches where it actually sits in the tree
rather than forcing paragraph-promotion logic to accommodate it.
`alias`/`emptyAlias` are stored on the node purely for byte-identical
round-trip — an embed renders live content, never its alias text, so
(unlike `wikiLink`) there is no rendered text on export to infer "was there
an alias" from; it has to be an explicit field.

### 5. One resolver, two consumers

`resolveTransclusion(file, blockId) => Promise<string | null>` is the only
new host service. It backs both transclusion content
(`TransclusionComponent`) and block-scoped-link existence styling
(`WikiLinkExistencePlugin`, which now splits plain and block-scoped links
into separate resolver paths) — avoiding a second, redundant host contract
for what is, from an existence-checking point of view, the same question
("does `file#^id` resolve to something").

### 6. Resolution happens in the lazily-loaded component, not the mapper

`mdastToLexical.ts`/`lexicalToMdast.ts` stay synchronous; the actual
resolver call happens inside `TransclusionComponent`, mirroring
`MermaidNode`/`MermaidComponent`'s existing static-node-plus-async-component
split. `resolveAndRenderTransclusion` (in `transclusion-render.tsx`) is
pure and framework-light enough to unit-test without mounting Lexical or
React at all.

### 7. Cycle guard: per-branch visited path; depth bound: 8

The guard is a visited-path array of `file#^blockId` keys threaded through
recursive resolution, **not** a single global "already transcluded
anywhere" set — the same block transcluded from two unrelated sites in one
document must not falsely trip the cycle check for the second site (a
requirement the fixture/unit-test suite pins down explicitly). The depth
bound (8) is checked *before* each level's resolver call, so a document
that would exceed it never spends host I/O on content that gets discarded.
Both are Plan-stage numeric/algorithmic choices with no existing precedent
in this codebase to inherit from — no recursion-guard or visited-set
pattern for cross-block content resolution existed here before this issue.

### 8. The transclusion mini-renderer is intentionally partial

Resolved content is parsed with the existing `parseMarkdown` and walked by
a small dedicated mdast→JSX renderer — not a second `LexicalComposer`
instance, since transclusion is explicitly render-only (bidirectional
editing of transcluded content is Out of Scope). Coverage is scoped to
paragraph/inline-formatting/checkbox-list-items/inline-code/nested-
`wikiEmbed`, with a generic plain-text fallback (recursively join every
`.value` found) for anything else. This satisfies "never crash on arbitrary
block content" (FR-015 — any `^id`-carrying block is a valid target, not
just checkboxes) without committing to full visual parity for every mdast
construct.

### 9. `openLink` gets an additive optional `blockId` parameter

A host that has not implemented block-aware navigation still receives
`url` and opens the file exactly as today — FR-004's "degrades no worse
than today's file-only wikilink navigation" falls out for free, with no
host-side change required. The `OPEN_LINK` wire message omits `blockId`
entirely when absent, rather than sending `blockId: undefined`.

## Consequences

**Good:**

- `[[file#^id]]` and `![[file#^id]]` round-trip byte-identically through
  `parseMarkdown -> stringifyMarkdown` (SC-001), verified for both forms,
  aliased and not, standalone and inside a table cell (the #347
  pipe-in-tables regression class).
- No existing wiki-link behavior changed: the full pre-existing wiki-link
  and #347 test suites pass unmodified (SC-005), and `<Editor>` mounted
  with no host services at all renders `![[file#^id]]` without throwing,
  as a clearly marked "unresolved" placeholder (SC-003/FR-008).
- A constructed transclusion cycle (direct, longer A→B→C→A, and unrelated
  same-block-two-sites) all resolve to the correct terminal state — cycle,
  resolved, or depth-exceeded — verified by automated test (SC-004), with
  no vendored second tokenizer package and its associated LICENSE/parity
  burden.

**Bad / accepted:**

- **`./markdown`-subpath parity gap grows.** A raw external consumer
  building their own pipeline from the exported extensions gets
  `data.blockId` on `wikiLink` for free, but never sees a `wikiEmbed` node
  at all — embed detection is main-`parseMarkdown`-pipeline-only. This
  mirrors an asymmetry this package already had (empty-alias handling,
  pipe-escaping), documented in `docs/markdown-pipeline.md` rather than
  left implicit.
- **`resolveTransclusion` is pull-based, with no push/invalidation
  channel.** "Reflects the change on next render" (FR-006) means exactly
  that: `TransclusionComponent` re-resolves on every Lexical editor update
  in its own document, which covers same-document edits automatically, but
  a change to the source block made *elsewhere* (a different open
  document, or outside the editor entirely) only shows up once the host
  itself triggers a re-render of the transcluding document. A host wanting
  tighter cross-document freshness has to build that itself.
- **Recursive resolution is unmemoized.** Every visible transclusion
  re-resolves, and re-parses its resolved markdown, on every dirty editor
  update, with no caching across renders. Acceptable given the depth bound
  caps worst-case fan-out per transclusion site, but a future optimization
  target if hosts report cost on documents with many transclusions.
- **The mini-renderer's node coverage is deliberately partial** (point 8).
  A transcluded block using an mdast construct outside its handled set
  (tables, footnotes, math, HTML) degrades to plain extracted text rather
  than rendering richly. This is a documented v1 scope limit, not a defect
  discovered later.
- **A wikilink target carrying an explicit `.md` extension does not
  round-trip byte-identically through the *full* Lexical editor pipeline**
  (parse → import → export → stringify), independent of blockId: separate
  from the anchor-specific bug this ADR's Context traced (which point 3
  above does fix), `lexicalToMdast.ts`'s `convertLinkNode` unconditionally
  strips a trailing `.md` from any wikilink URL on export, and
  `CustomLinkNode`'s URL is the only channel carrying the file target — it
  cannot distinguish "the source wrote `notes.md`" from "the source wrote
  `notes` and import added the extension". This is a pre-existing, general
  property of `convertLinkNode` unrelated to and predating this issue;
  fixing it is out of scope here. Recorded as
  `fixtures/roundtrip/known-defects/other-wikilink-blockid-md-extension-stripped`
  (see that corpus's `README.md`), not silently worked around.

**Neutral:**

- The headless `./nodes` entry point (no React mounted) gets an inert,
  data-only `TransclusionNode` — consistent with how Mermaid/C4/equations
  already behave there (lazy-render only when actually mounted in a
  browser DOM), not a gap specific to this feature.

## References

- Issue #119 (this decision)
- `src/markdown/vendor/mdast-util-wiki-link/README.md` (the vendoring
  rationale this issue extends rather than duplicates, and the fifth
  divergence — blockId splitting — this issue adds to it)
- `docs/markdown-pipeline.md` (the `./markdown`-subpath parity gap this
  issue grows, and the embed-sentinel mechanism)
- `docs/editor-api.md` (`resolveTransclusion` host-service row)
- `src/app/mapper/__tests__/fixtures/roundtrip/README.md` (the
  `known-defects/` convention this issue's accepted `.md`-extension gap
  follows)
- `docs/decisions/adr-075.md` (the host-seam / persistence boundary and
  closed `exports` map this issue's resolver and node registration follow)

# Markdown round-trip fixture corpus

This directory is the fixture corpus for `fixture-roundtrip.test.ts`. Each fixture is
run through the real production pipeline — `parseMarkdown` -> `importMarkdownToLexical`
-> `exportLexicalToMdast` -> `stringifyMarkdown` — with no edit applied, and the result
is asserted against either the original input or a companion expected-output file.

## Adding a fixture

Drop a `<name>.md` file anywhere under this directory (subdirectories are fine — they
just group tests in the report). No test code needs to change; the file is discovered
automatically the next time the suite runs.

- **No companion file**: the round-tripped output must be byte-identical to the input.
  Use this for constructs the pipeline currently handles faithfully.
- **`<name>.expected.md`**: when the round-tripped output legitimately differs from the
  input (a normalization the pipeline performs, or a documented current defect), add a
  sibling file with the same stem and an `.expected.md` extension containing the actual
  round-tripped output. The suite asserts against this file instead of the input.
- **`<name>.error.txt`**: if `roundTrip()` is expected to throw for a fixture, add a
  sibling `.error.txt` containing a substring of the expected error message. The suite
  asserts the promise rejects with a matching error instead of comparing output text.
- **`<name>.idempotence-exempt.txt`**: every fixture that round-trips *successfully* has
  its output (input-or-`.expected.md`, whichever applies) round-tripped a second time with
  no edits, and that second pass must be byte-identical to the first (see "Idempotence"
  below). Fixtures with an `.error.txt` sidecar are excluded by construction — they have
  no first-pass output to feed back, so the assertion does not apply to them. If a
  fixture's *first-pass* output is legitimately, pre-existingly non-idempotent for reasons
  unrelated to what the fixture is testing, add a sibling `.idempotence-exempt.txt`
  containing the reason; the suite skips the second-pass assertion for that fixture only.
  An exemption file that exists but is empty is a hard error — the reason is mandatory.
  This is not a general escape hatch — it exists for one documented case today (see the
  `902-list-item-double-hard-break*` section below).
- **`<name>.export-options.json`**: most fixtures exercise the pipeline's default export
  configuration. If a fixture needs a non-default `ExportOptions` value (e.g.
  `{"wikiLinkPromotion":"off"}`), add a sibling `.export-options.json` file containing the
  JSON object to pass as `roundTrip()`'s `exportOptions`. It's read by `discoverFixtures`
  and threaded through both the first-pass and second-pass (idempotence) round trips, so
  the non-default configuration applies consistently to a fixture's whole test. Absent, a
  fixture gets `{}` — today's default behavior. See the `951-no-wiki-link-promotion/`
  section below for the fixture group that uses this.

A file is only picked up as a fixture if it ends in `.md` and its name does not end in
`.expected.md`; `README.md` itself is excluded.

## The `known-defects/` directory

Fixtures under `known-defects/` reproduce round-trip fidelity losses that exist in the
pipeline today. They are asserted against `.expected.md` files that capture the
*current, defective* output — the suite is green today, and becomes the regression gate
the moment each defect is fixed (update the `.expected.md` to the fidelity-preserving
result and the fixture starts enforcing it).

- **`897-*`**: originally reproduced [#897](https://github.com/verveguy/liminis/issues/897)
  — block content (fenced code, tables, blockquotes, multiple paragraphs) inside list
  items was dropped and remaining paragraphs collapsed onto one line. Fixed — these now
  round-trip byte-identical to their input (no `.expected.md` sidecar), so they've become
  a permanent regression gate rather than a documented defect. Left under
  `known-defects/` rather than moved, since the directory just tracks where the fixture
  originated. Additional coverage for this fix (deeper nesting, first/last-child
  positioning, mixed block types, task-list items) lives directly under
  `fixtures/roundtrip/`.
- **`903-image-alt-bracket-pair`**: originally filed as `other-image-alt-bracket-escaping-
  corrupted` — an image's alt text containing a bracket pair (e.g. `alt [bracket] text`)
  was double-escaped by the bracket-preservation post-process step in `stringify.ts`,
  corrupting the image syntax further on a second round trip. Fixed by
  [#903](https://github.com/verveguy/liminis/issues/903) — image alt text with balanced
  bracket pairs now round-trips byte-identical to its input (no `.expected.md` sidecar).
  Renamed to the `903-*` convention and left under `known-defects/`, per the `897-*`
  precedent, since the directory just tracks where the fixture originated. Additional
  edge-case coverage for this fix (multiple pairs, leading/trailing placement, badge-
  pattern nesting, pre-escaped source normalization) lives directly under
  `fixtures/roundtrip/`.
- **`other-*`**: additional round-trip fidelity losses discovered while building this
  corpus, for constructs the spec (FR-009) requires coverage of but that aren't part of
  the #897/#898 issue bodies: nested blockquotes (inner paragraphs collapse
  and nested quotes are hoisted out, mirroring the #897 mechanism at the blockquote
  level rather than the list-item level).
  `other-blockquote-list-content-lost` records a starker instance of the same
  blockquote-level mechanism, found during #943's review: a **list inside a
  blockquote is dropped entirely** on round trip — `> Steps to reproduce:` followed
  by a quoted bullet list serializes back as the lead-in paragraph alone, and a
  blockquote whose only content *is* a list serializes back as a bare `>`. This is
  silent data loss and predates #943 (verified against the pre-change
  `stringify.ts`: byte-identical behaviour). It is unrelated to either #943 fix —
  the loss happens in the mapper, not the serializer — and needs its own issue.
  Note the lossy output is a stable fixed point, so #943's idempotence assertion
  does **not** catch it: a fixed point is a guarantee about *stability*, not about
  *fidelity*. The first-pass `.expected.md` comparison is what pins it.
  A genuinely unbalanced bracket in image alt text (`other-image-alt-unbalanced-bracket-
  corrupted`, e.g. `![unbalanced [ bracket](img.png)`) still corrupts on round trip — the
  #903 fix only unescapes *properly nested* bracket pairs within an image's alt-text
  span, so a lone unpaired `[` is deliberately left to the pre-existing (unchanged)
  behavior. Similarly, an alt-text span with an *equal count* of escaped `[`/`]` but out
  of nesting order (`other-image-alt-bracket-order-corrupted`, alt text `a]b[c`, sourced
  as `![a\]b\[c](img.png)`) also still corrupts on round trip: equal counts alone don't
  mean the brackets are balanced (the `]` here closes nothing), so naively unescaping it
  would leave a bare `]` mid-label and truncate the image early — a strictly worse
  failure than the pre-existing defect. The #903 fix checks nesting depth, not just
  counts, specifically to avoid producing that worse corruption; the span is left
  untouched and falls through to the same pre-existing (unchanged) bracket-preservation
  behavior as the unbalanced-single-bracket case above.
  A bracket pair in plain paragraph text outside any link/image (`other-plain-text-
  bracket-pair-escaped`) is a regression-guard fixture for the bracket-preservation
  regex's original, still-current, intended behavior (escaping a literal `[bracket]` pair
  to `\[bracket\]`), added because #903 changed the surrounding code and nothing in this
  corpus previously pinned that behavior down.
  These are not tracked by a specific issue yet; if one is filed, rename the fixture to
  match the `NNN-*` convention above.
- **`other-callout-first-line-inline-formatting-space-lost`**: discovered while adding
  feature coverage for `CalloutNode` ([#1](https://github.com/verveguy/liminis-editor/issues/1)).
  `convertBlockquote`'s callout detection in `mdastToLexical.ts` computes the callout's
  first line of body text as `firstText.value.slice(calloutMatch[0].length).trim()` —
  the trailing `.trim()` is meant to strip the newline between `[!WARNING]` and the body
  text, but when that body text is itself immediately followed by another inline node
  (e.g. `This has **bold**`), the same `.trim()` also eats the significant trailing space
  before that node, corrupting `This has **bold**` into `This has**bold**`. The bold/
  italic/code node itself and its content survive intact — only the one space is lost.
  Not fixed here: the corpus addition for #1 is scope-limited to test fixtures (see its
  spec's Out of Scope section); `callout/inline-formatting.md` covers the same
  bold/italic/code shapes without tripping this defect by placing them in the callout's
  *second* paragraph, which takes a different, unaffected code path.
- **`other-toggle-nested-in-list-item`**: discovered while adding feature coverage for
  `ToggleContainerNode`/`ToggleTitleNode`/`ToggleContentNode` ([#1](https://github.com/verveguy/liminis-editor/issues/1)).
  `preprocessDetailsBlocks` in `mdastToLexical.ts` scans only the top-level
  `root.children` once, before the main per-node dispatch loop runs — no other code path
  recognizes a `<details>`/`<summary>` block. A `<details>` block nested inside a list
  item can therefore never construct a real `ToggleContainerNode` regardless of its
  content; it falls through to the generic `convertHtml` handling and becomes an opaque
  `HtmlNode` instead. The raw bytes still round-trip byte-identical (verbatim HTML
  pass-through), so this is not data corruption, but it does mean the toggle construct's
  "nested inside a list item" shape has no real structural coverage — this fixture
  documents that gap rather than silently omitting the shape.
- **`other-titled-link-wikilink-url`**: originally reproduced
  [#919](https://github.com/verveguy/liminis/issues/919) — a titled standard link whose
  URL is classified as a wiki-link by `isWikiLinkUrl` in `lexicalToMdast.ts` (relative
  `.md` paths, directory paths, and anchor-only URLs) was exported as a mdast `wikiLink`
  node instead of a `link` node. The `wikiLink` mdast type has no title concept, so the
  title was silently dropped even after [#904](https://github.com/verveguy/liminis/issues/904)
  fixed title round-tripping for standard `link` nodes. Fixed by guarding the wiki-link
  promotion in `convertLinkNode` on the link having no title (`isWikiLinkUrl(url) &&
  !linkNode.getTitle()`) — a title is a strong signal the author deliberately used
  standard markdown link syntax, which wiki-link syntax has no slot for. This now
  round-trips byte-identical to its input (no `.expected.md` sidecar), so it's become a
  permanent regression gate rather than a documented defect. Left under `known-defects/`
  rather than moved, per the `897-*` precedent above. Additional coverage (untitled
  variant proving the wiki-link promotion heuristic itself is unchanged, plus the other
  URL shapes `isWikiLinkUrl` classifies — anchor-suffixed `.md` path, bare anchor, and
  directory-style path — each with a title) lives directly under `fixtures/roundtrip/`.
- **`other-table-column-alignment-lost`, `other-table-single-column-aligned`**:
  originally reproduced [#907](https://github.com/verveguy/liminis/issues/907) — GFM
  table column alignment (`:---` left, `:---:` center, `---:` right) collapsed to a
  bare `-` for every column on export, regardless of the source delimiter row. Fixed —
  alignment is now carried on the Lexical `TableCellNode` via its existing (previously
  inert) `format` field on import and read back from the header row on export. Both
  fixtures now round-trip byte-identical to their input (no `.expected.md` sidecar),
  so they've become a permanent regression gate rather than a documented defect. Left
  under `known-defects/` rather than moved, since the directory just tracks where the
  fixture originated.
- **`other-definition-list-structure-lost`**: originally reproduced
  [#906](https://github.com/verveguy/liminis/issues/906) — definition lists were
  converted to a bold-term paragraph followed by plain paragraphs, losing the
  term/definition structure entirely. Fixed via dedicated `DefinitionListNode`/
  `DefinitionTermNode`/`DefinitionDescriptionNode` Lexical node types (see
  `mdastToLexical.ts`'s `defList` case and `lexicalToMdast.ts`'s
  `convertDefinitionListNode`) that round-trip cleanly to real `defList`/
  `defListTerm`/`defListDescription` mdast nodes — this now round-trips byte-identical
  to its input (no `.expected.md` sidecar), so it's become a permanent regression gate.
  Left under `known-defects/` rather than moved, mirroring the `897-*` precedent.
  Additional coverage (single-definition and multi-definition-with-inline-formatting
  cases) lives directly under `fixtures/roundtrip/` as `definition-list-single.md` and
  `definition-list-multi.md`.
- **`other-html-block-attributes-lost`, `other-inline-html-escaped`**: originally
  reproduced [#909](https://github.com/verveguy/liminis/issues/909) — block-level HTML
  (e.g. a `<div>` wrapping other markup) lost its tags and attributes entirely on
  import, and inline HTML (e.g. a `<span>`) survived as text but had its angle
  brackets escaped on export. Fixed via a new opaque `HtmlNode` decorator that carries
  raw HTML markup through the pipeline unmodified — these now round-trip
  byte-identical to their input (no `.expected.md` sidecar), so they've become a
  permanent regression gate rather than a documented defect. Left under
  `known-defects/` rather than moved, per the `897-*` precedent above. Additional
  coverage for this fix (a combined block+inline document, and a check that genuine
  literal `<`/`>` in prose still escapes) lives directly under `fixtures/roundtrip/`.
- **`other-strong-inline-math-not-wrapped`, `other-emphasis-footnote-not-wrapped`,
  `other-delete-inline-math-not-wrapped`**: discovered while fixing #898 review feedback
  that `convertStrong`/`convertEmphasis`/`convertDelete` in `mdastToLexical.ts` silently
  dropped `EquationNode`/`FootnoteNode`/`LineBreakNode` children (e.g. `**$x$**` or
  `_see note[^1]_` lost the math/footnote entirely). That data-loss bug was fixed first —
  these nodes were passed through unformatted rather than skipped — but a residual gap
  remained: only `TextNode` could carry Lexical's bold/italic/strikethrough format bits,
  so on export the equation/footnote node fell outside the mdast `strong`/`emphasis`/
  `delete` wrapper instead of staying nested inside it (`**$O(n)$ complexity**` round-tripped
  to `$O(n)$** complexity**`). Fixed by [#908](https://github.com/verveguy/liminis/issues/908):
  `EquationNode`/`FootnoteNode` now carry a format bitmask mirroring `TextNode`'s (see
  `getFormat`/`hasFormat`/`setFormat`/`toggleFormat` on both node classes), and
  `convertInlineChildren` in `lexicalToMdast.ts` merges a run of consecutive siblings
  sharing the same non-zero format into a single wrapper when the run contains a
  non-text member. `other-strong-inline-math-not-wrapped` and
  `other-delete-inline-math-not-wrapped` now round-trip byte-identical (no `.expected.md`
  sidecar, so they're a permanent regression gate). `other-emphasis-footnote-not-wrapped`
  keeps an `.expected.md` sidecar, but only to capture an unrelated, pre-existing
  footnote-*definition* spacing normalization (`[^1]: A note.` → `[^1]:  A note.`, an
  extra space already present on `footnotes.md` and `link-with-footnote-reference.md`,
  neither of which this issue touches) — the marker-wrapping defect itself is fixed.
  Additional coverage for this fix (italic wrapping math, a bare math-only span, math at
  the end of a span, and a single span mixing text + math + footnote) lives directly
  under `fixtures/roundtrip/`: `emphasis-inline-math.md`, `strong-inline-math-only.md`,
  `strong-inline-math-trailing.md`, `strong-mixed-text-math-footnote.md`.

  A follow-up review pass on #908 caught a second, narrower gap in the same fix: a
  formatted run made up *entirely* of math/footnote nodes (no adjacent `TextNode`) had
  no way to recover the original `_`/`*` marker choice, since `--md-strong-marker`/
  `--md-emphasis-marker` were only ever read off `TextNode.style`. A bare `_$O(n)$_`
  (no surrounding text) round-tripped to `*$O(n)$*` — content and wrapping stayed
  correct, but the marker character silently flipped. Fixed by giving `EquationNode`/
  `FootnoteNode` their own `getStrongMarker`/`setStrongMarker`/`getEmphasisMarker`/
  `setEmphasisMarker` pair (set on import in `convertStrong`/`convertEmphasis`, read on
  export in `convertFormattedRun`), mirroring the existing `TextNode` style-based
  mechanism. Covered by `emphasis-inline-math-only.md`, `emphasis-footnote-only.md`
  (footnote-definition case, same pre-existing spacing sidecar as above), and
  `strong-inline-math-only-underscore.md`.

## The `902-list-item-double-hard-break*` fixture set

Fixed [#902](https://github.com/verveguy/liminis/issues/902): the #897 fix's
paragraph-boundary marker (two bare, adjacent `LineBreakNode`s) was ambiguous with a
genuine double hard break occurring inside a single mdast paragraph (e.g. a line ending
in `\` immediately followed by a line that is only `\`), which got misread as the
marker and incorrectly split one paragraph into two. The marker is now a dedicated
`ListItemParagraphBreakNode` (`editor/nodes/ListItemParagraphBreakNode.ts`), structurally
distinct from `LineBreakNode` by construction, so no number of consecutive real hard
breaks can ever collide with it.

- **`902-list-item-double-hard-break`** (promoted from
  `known-defects/other-list-item-double-hard-break`, the original reproducing fixture):
  a list item paragraph with a trailing-backslash line immediately followed by a
  backslash-only line, then more text — the exact ambiguous shape #902 closes.
- **`902-list-item-double-hard-break/`**: additional edge-case coverage —
  `three-consecutive-paragraphs` (multiple paragraph-boundary markers in sequence),
  `double-break-adjacent-to-boundary` (a double hard break and a genuine
  paragraph-boundary marker next to each other in the same item), `triple-hard-breaks`
  (three consecutive breaks, not just two), `nested-list-double-break` (the ambiguity at
  a nested list's own item), and `task-list-double-break` (an unordered checklist item).

**A note on byte-identity**: fixtures containing a hard break authored with the
trailing-backslash notation carry an `.expected.md` sidecar rather than being
byte-identical to their input. This is *not* a residual #902 defect — it's a
pre-existing, orthogonal normalization in `stringify.ts`'s hard-break handling (from
`mdast-util-to-markdown`) that rewrites `\` + newline to two trailing spaces + newline
for *any* hard break, anywhere in the pipeline, independent of list items or this
marker. (It's also not optional: a genuinely empty line — no backslash, just the
continuation indent and trailing spaces — reads back as a blank line and terminates the
paragraph, so the backslash notation is the only way to author "two adjacent hard breaks
with literally nothing between them" in source markdown at all.) What #902 actually
guarantees — and what each `.expected.md` here asserts — is that the output stays a
*single* paragraph containing the right number of `break` nodes, never split into two.

**A note on idempotence**: the same trailing-spaces normalization means the *first-pass*
output above is not a stable fixed point either — the double-hard-break marker serializes
as a line containing only the two trailing spaces of a hard break, and CommonMark treats
a whitespace-only line as blank regardless of trailing spaces, so re-parsing that output
splits the paragraph on a second pass. [#943](https://github.com/verveguy/liminis/issues/943)
identified this as an instance of exactly the class of pre-existing, documented
normalization its own Out of Scope section excludes from the idempotence guarantee it
otherwise added to this suite (see "Idempotence" below) — so `902-list-item-double-hard-
break` and four of its five sibling fixtures (`double-break-adjacent-to-boundary`,
`nested-list-double-break`, `task-list-double-break`, `triple-hard-breaks`) each carry a
`.idempotence-exempt.txt` sidecar recording this. `three-consecutive-paragraphs` is
unaffected (no whitespace-only line results) and needs no exemption.

## Idempotence

Beyond matching its expected first-pass output, every fixture that round-trips
*successfully* has its output round-tripped a *second* time with no edits, and that second
pass must be byte-identical to the first — added by
[#943](https://github.com/verveguy/liminis/issues/943) (FR-003/SC-002) to catch drift that
only shows up once a document is already in its round-tripped, canonical form. This matters
most for `.expected.md` fixtures: matching the sidecar on the first pass says nothing about
whether that sidecar's own content is itself a stable fixed point. See the
`.idempotence-exempt.txt` sidecar convention above for the documented, out-of-scope
exceptions.

Two categories are outside the assertion rather than exempt from it. `.error.txt` fixtures
are excluded **by construction**: `roundTrip()` rejects on the first pass, so there is no
output to feed back — the test returns before reaching the second-pass block. (The corpus
has none today, but the harness supports them.) And note what the assertion does *not*
buy you: a fixed point is a guarantee about **stability**, not **fidelity**. A round trip
that silently drops content reaches a fixed point immediately and passes — see
`known-defects/other-blockquote-list-content-lost`, where a list inside a blockquote is
lost entirely yet the lossy output is perfectly stable. The first-pass `.expected.md`
comparison is what catches fidelity loss; the second pass only catches drift.

**Every exemption in this corpus**, in full (there are five, all one pre-existing cause):

| Fixture | Reason |
| - | - |
| `902-list-item-double-hard-break` | #902's double-hard-break marker serializes as a whitespace-only line, which CommonMark re-reads as blank, splitting the paragraph on the second pass. Carries the full written reason. |
| `902-list-item-double-hard-break/double-break-adjacent-to-boundary` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/nested-list-double-break` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/task-list-double-break` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/triple-hard-breaks` | Same cause; cross-references the root sidecar. |

Fixing that underlying hard-break normalization is out of scope for #943 and needs its
own issue. No other fixture in the corpus is exempt, including all 23 in
`known-defects/` — asserting a *defective* first-pass output does not stop that output
from being a stable fixed point, and in this corpus every one of them is.

## The `50-*` fixture set

Ported by [#943](https://github.com/verveguy/liminis/issues/943) from
[verveguy/zusammen#62](https://github.com/verveguy/zusammen/pull/62): the markdown
serializer was non-idempotent around lists. The concrete reported defect — a single blank
line between a preceding block and a following list was dropped to zero — came from a
custom `join` override in `stringify.ts` that forced zero blank lines whenever a paragraph
ending in `:` was immediately followed by a `list`/`table`/`code`/`math` node, regardless
of the source's actual blank-line count (which mdast doesn't represent at all — blank-line
count between flow siblings is discarded on parse). Fixed by excluding `list` from that
override's target types, so a colon-ending paragraph before a list now gets the same
one-blank-line promotion every other preceding-block type already got. `table`/`code`/
`math` keep the pre-existing zero-blank "label:" convention — unchanged and out of this
issue's scope.

A second, previously undiscovered defect was fixed alongside it: a post-process regex
(`result.replace(/\n{3,}/g, '\n\n')`) meant to collapse runs of 2+ blank lines between
sibling blocks turned out to have no legitimate job left for that purpose —
`mdast-util-to-markdown`'s own join logic already never emits 3+ consecutive newlines for
sibling flow blocks by construction — and its only real effect was corrupting intentional
multi-blank-line runs inside verbatim content (fenced code block bodies, frontmatter YAML
block-scalar values). Removed outright rather than made verbatim-span-aware.

- **`50-colon-paragraph-blank-line-before-list.md`,
  `50-colon-paragraph-blank-line-before-numbered-list.md`**: the reported defect, fixed —
  now byte-identical.
- **`50-colon-paragraph-no-blank-before-list.md`** + `.expected.md`: the tight-adjacency
  case (no source blank line) for a colon-ending paragraph — pins the accepted one-time
  canonicalization diff of gaining a blank line, consistent with every other
  preceding-block type.
- **`50-heading-blank-line-before-list.md`, `50-blockquote-blank-line-before-list.md`,
  `50-code-block-blank-line-before-list.md`, `50-table-blank-line-before-list.md`,
  `50-list-blank-line-before-list.md`**: every other preceding-block type before a list,
  each already stable and byte-identical before and after this fix.
- **`50-multiple-blank-lines-between-paragraphs.md`,
  `50-multiple-blank-lines-before-list.md`** (each with `.expected.md`): pin the 2+-blank-
  line-collapses-to-one canonicalization that the removed regex used to (incorrectly)
  implement, proving the library's own join logic provides the same guarantee without it.
- **`50-blank-lines-inside-fenced-code-block.md`,
  `50-blank-lines-inside-frontmatter-yaml.md`**: byte-identical regression fixtures for the
  verbatim-content corruption the removed regex caused.
- **`50-nested-list-blank-line-separation.md`** + `.expected.md`: a blank line before a
  nested list inside a list item canonicalizes to zero, not one — this is a distinct,
  pre-existing convention from the top-level fix (governed by `computeListSpread`'s
  tight/loose classification, not the `join` override), left unchanged and pinned here to
  document it explicitly rather than leave it as an implicit assumption.
- **`50-list-first-block-in-document.md`, `50-list-at-end-of-document.md`**: edge cases at
  the start/end of a document, both byte-identical.
- **`50-reference-readme.md`** + `.expected.md`: a synthetic, ~13.8 KB document exercising
  the representative corpus's constructs at realistic document scale, including the exact
  reported defect phrase. Ported from Zusammen with its prose adapted to Liminis's own
  architecture, but its construct inventory preserved position-for-position; its
  `.expected.md` is generated from *this* repository's pipeline rather than copied.
  Reaches a stable fixed point after one canonicalization pass; its only differences from
  the original bytes are blank-line canonicalization.

## The `943-*` fixtures

Four fixtures added by [#943](https://github.com/verveguy/liminis/issues/943) beyond the
ported `50-*` set. The first two pin the half of the `join` override that deliberately did
*not* change — the corpus had no regression guard for it on either side:

- **`943-colon-paragraph-blank-line-before-table.md`** + `.expected.md`
- **`943-colon-paragraph-blank-line-before-math.md`** + `.expected.md`

Each is a colon-ending paragraph, a blank line, and a table or block-math node. Both
still canonicalize the blank line away, confirming the "label:" convention survives for
`table`/`code`/`math` while `list` no longer participates in it.

The other two pin the **`lastChild?.type === 'text'` boundary** of the colon detection,
raised in review. The override only recognizes a colon when the paragraph's final inline
node is a plain `text` node, so a paragraph ending in `**Steps:**`, `` `config.yaml:` ``
or `_Notes:_` — visually colon-ending, but ending in a `strong`/`inlineCode`/`emphasis`
node — is not detected and falls through to the default join. Both fixtures are
byte-identical (no `.expected.md`):

- **`943-non-text-colon-paragraph-before-list.md`**: those three non-text-final shapes
  before bulleted and numbered lists. All get exactly one blank line — **the same as a
  plain-text colon does after this fix**. So for lists the text/non-text distinction is
  now unobservable: FR-001 did not introduce an edge-case divergence here, it *removed*
  the one that existed. This fixture is what stops it coming back.
- **`943-non-text-colon-paragraph-before-verbatim.md`**: the same non-text-final shapes
  before a fenced code block and a table, where the distinction *is* still observable —
  `**Fenced code:**` keeps its blank line while a plain `Fenced code:` loses it. That
  asymmetry is pre-existing, unchanged by this issue, and deliberately left alone (FR-001
  retains `table`/`code`/`math` behaviour); it is pinned here so the convention's actual
  scope is documented rather than assumed.

## The `951-no-wiki-link-promotion/` fixture group

Added by [#951](https://github.com/verveguy/liminis/issues/951): `convertLinkNode` in
`lexicalToMdast.ts` promotes an untitled relative link (a `.md` path, a `.md` path with
an anchor, a bare `#anchor`, or a directory-style path — see `isWikiLinkUrl`) to
wiki-link syntax (`[[target]]` / `[[target|alias]]`) on export by default — the behavior
every other fixture in this corpus exercises. This group instead pins the opt-out
configuration (`{"wikiLinkPromotion":"off"}`, set via the `.export-options.json` sidecar
described above): each fixture round-trips as a standard markdown link, byte-identical to
its input, instead of being promoted.

- **`relative-md-link.md`** (`[notes](notes.md)`): the untitled relative `.md` link — the
  same URL shape as the corpus's pre-existing `relative-md-link-without-title.md`, which
  pins the *default* (promote) behavior for this shape via its own `.expected.md`. This
  fixture pins the opposite: with the option off, the same input stays a standard link.
- **`relative-md-link-anchor.md`** (`[note](./notes.md#section)`): a `.md` path with an
  anchor.
- **`bare-anchor.md`** (`[section](#section)`): a bare anchor-only link.
- **`directory-link.md`** (`[folder](./folder/)`): a directory-style (trailing-slash)
  link.
- **`genuine-wiki-link.md`** (`[[notes|note]]`) and **`genuine-wiki-link-bare.md`**
  (`[[notes]]`): the opt-out's other edge — a link that was already wiki-link syntax in
  the source, not an ordinary standard link this option is meant to stop promoting. These
  pin that `wikiLinkPromotion: 'off'` only suppresses promotion of an *ordinary* link; a
  genuine, author-written wiki-link still round-trips as one, since demoting it back to
  `[text](target)` would corrupt a document's existing links (the exact failure mode this
  option exists to prevent, just in the opposite direction). The two are distinguished by
  provenance tracked on the parsed link node (`CustomLinkNode.getWikiLinkOrigin()`), not
  by the URL, which is identical to `relative-md-link.md`'s either way.

Each is byte-identical to its input (no `.expected.md`) and, like every other
successfully round-tripping fixture in this corpus, gets its output round-tripped a
second time to confirm the opt-out configuration is idempotent too (see "Idempotence"
below) — the `.export-options.json` sidecar applies to both passes.

## The `973-*` fixture set

Added by [#973](https://github.com/verveguy/liminis/issues/973). A code-formatted Lexical
`TextNode` that *also* carried a bold/italic/strikethrough bit was treated as **pure**
inline code and pulled out of its enclosing wrapper, so `` **`code` more text** `` lost
its `**` on the first pass and drifted to `\*\*` on the second. A dozen-plus of this
repository's own ADRs contain that shape, so merely opening and saving one destroyed its
formatting, a bit more with each save.

**Interior-mixed, not standalone adjacency.** Every fixture here puts the code span
*inside* the wrapper. A separate `**bold**` merely sitting next to a separate `` `code` ``
span was never broken and is already stable, so a fixture of that shape would have no
regression value. The same distinction governs which documents
`issue-973-adr-idempotence.test.ts` selects.

Six of the eight fixtures are the shapes named by the spec's FR-006, all byte-identical to
their input (no `.expected.md`):

- **`973-strong-code-only.md`** (`` **`--flag`** ``): a wrapper whose entire content is
  code. Run length 1, so it bypasses all the run-merging machinery and is fixed by the
  `convertTextNode` change alone.
- **`973-strong-code-leading.md`**, **`973-strong-code-trailing.md`**: the code span at
  either end of the wrapper.
- **`973-strong-two-code-spans.md`** (`` **`--in` then `--out`** ``): two code spans under
  one wrapper, pinning that they stay two `inlineCode` nodes inside a *single* wrapper
  rather than splitting it apart.
- **`973-emphasis-code-leading.md`** (`*`), **`973-strong-underscore-code-leading.md`**
  (`__`): the marker-style guard. A run whose only styled member is code-formatted must
  keep its original marker, which is why `convertFormattedRun` reads its
  `--md-strong-marker` / `--md-emphasis-marker` hints *above* the code branch, not after
  it. Without that, `__` normalizes to `*`.

Two more are not in FR-006 and are here deliberately:

- **`973-strong-emphasis-code.md`** + `.expected.md`: bold **and** italic **and** code on
  one node. This shape is *newly reachable* — before the fix the code short-circuit
  discarded both wrappers — so it is new behaviour and needs pinning. Its first pass
  canonicalizes the nesting order (`` **_`x`_** `` → `` _**`x`**_ ``), because both wrapper
  builders apply **bold innermost, then italic, then strikethrough outermost**; the second
  pass re-imports to the identical bitmask and is a fixed point. That one-time
  canonicalization is legitimate under ADR-076. The `.expected.md` content is recorded from
  actual output, not predicted.

  Do **not** align this nesting order with `formatAliasWithMarkers` in
  `lexicalToMdast.ts`, which is deliberately inverted and scoped to wiki-link aliases.

- **`973-literal-asterisks-near-code.md`**: a genuinely bare `\*\*` beside a code span.
  This one is green both before and after the fix, by design. The issue described the
  second-pass `**` → `\*\*` drift, and it would be easy to conclude the fix merely *hides*
  an escaping defect. It does not: `stringify.ts` applies no custom asterisk handling, and
  the drift was a consequence of a wrapper the mapper should never have emitted bare being
  made flush against a backtick. This fixture makes "a real literal `**` still escapes
  stably" a red-able assertion rather than an argument.

### The real-document companion suite

The fixtures above are minimal by construction. `issue-973-adr-idempotence.test.ts` is the
counterweight, asserting the same fixed point over 32 real, human-written ADRs full of
tables, definition lists, nested lists and raw HTML. 16 of them were red before the fix.

Those documents are **vendored** into `../real-documents/` as byte-identical copies, not
read live from `docs/project_notes/decisions/`. The first version of that test walked six
directories up into the application repository — the only test under `packages/editor/`
reading outside the package. When [#949](https://github.com/verveguy/liminis/issues/949)
extracts this package into `verveguy/liminis-editor`, a live read has two possible fates
and both are bad: the suite fails on day one in the new repo, or someone makes the missing
directory skip and the test goes permanently vacuous in the repo where the package actually
lives. Vendoring keeps the realistic-content property and lets the test travel with the
package.

Keep it a **sibling** of `fixtures/roundtrip/`, never inside it: the five auto-discovering
corpus suites all scan `fixtures/roundtrip` specifically, and 260 KB of ADRs would be
dragged into every one of their runs.

The suite asserts **second pass == first pass only** — never first pass == source bytes.
Real ADRs hit unrelated, already-accepted normalizations recorded in `known-defects/`, so
byte-identity with the source would fail for reasons that have nothing to do with #973.

### Three changes here that look removable and are not

The first two are Liminis-specific, with no counterpart in the reference implementation
([verveguy/zusammen#72](https://github.com/verveguy/zusammen/pull/72), which never merged).

**The `hasCodeMember` disjunct in `convertInlineUnit`'s formatted-run gate.** Zusammen's
gate merges any multi-member same-format run unconditionally; Liminis narrowed it to
`runTouchesMark` (#970/#977) so mark-free documents keep byte-identical output. That
narrowing means a mark-free `` **`code` more text** `` would otherwise fall through to the
per-node path and emit two adjacent `strong` nodes, which `mdast-util-to-markdown` will not
join — `` **`--flag`**** sets the mode** ``, a different corruption. Simplifying the gate
back toward Zusammen's shape reintroduces it; `973-strong-code-leading.md` is the guard.

**The `!getMergeableFormat(...)` guard in `mergeableRunBounds`.** That function reports the
delimiter run a boundary leaf sits in, which `hoistTargetAt` uses to place annotate-mode
sentinels. Its code branch is consulted *before* `getMergeableFormat`, so without the guard
a code+bold node's run is computed as a *code* run — no longer the run the emitter
produces. The symptom is not a malformed document but a **wrong recovered annotation
range**: an annotation on just `--flag` inside `` **the option `--flag`** `` has both
sentinels hoisted out to the whole wrapper, and a host's refresh pass then stores *that*
as the annotation's target, widening it on every pass.

Neither `annotated-serialize-corpus.test.ts` nor any other corpus suite catches this — both
of that suite's marking strategies mark either every leaf or the whole phrasing run, and
this needs a mark on a *single interior* code leaf with un-marked same-format siblings
beside it. `issue-973-annotate-code-in-wrapper.test.ts` exists for exactly that gap.

**The `!getMergeableFormat(...)` narrowing of `convertInlineUnit`'s *pure-inline-code* fast
path.** That path concatenates a mark-split code run into a single bare `inlineCode` via
`convertCodeRun`, which emits no wrapper — correct for pure code, and a re-run of #973 for
code that also carries a bold/italic bit. Without the narrowing, an annotation covering
part of a bolded code span serializes `` A **`hello world`** note. `` as
`` A `hello world` note. ``, dropping the `**`.

It only bites when the run has two or more members and one of them is marked, so it needs a
mark over *part* of a code span — the shape that leaves two adjacent same-format code
`TextNode`s. Marking whole leaves never produces it, which is why every other case in the
suite stays green with the guard reverted. The
`a mark splitting a code span inside a wrapper` cases in
`issue-973-annotate-code-in-wrapper.test.ts` are the guard; the pure-code case beside them
is the complement, green either way, proving the unchanged path stayed unchanged.

### A fourth subtlety: where the marker-hint read sits

`convertFormattedRun` reads its `--md-strong-marker` / `--md-emphasis-marker` hints
**above the code branch but below the `text === ''` early-continue**. Both halves of that
position matter, and they pull in opposite directions:

- *Above the code branch*, because a run whose every member is code-formatted would
  otherwise never reach the read at all, and `__` would normalize to `**` (FR-004).
- *Below the empty-text continue*, because the hints are captured with `??` — first
  non-null wins — so an **empty** format-carrying node preceding the run's real content
  would otherwise decide the marker for the whole wrapper. Lexical creates empty
  format-carrying `TextNode`s as caret placeholders when a format is toggled before
  anything is typed, and one can carry a stale marker style. Before #973 such nodes hit
  the `continue` first and had no influence; that is preserved.

`issue-973-empty-node-marker-hint.test.ts` pins both directions. Note it builds its states
with `parseEditorState` rather than `editor.update()`: Lexical's normalization strips an
empty `TextNode` during a live update, so an `update()`-built version of that test passes
whether or not the code is correct. That is also why the shape is reachable in production —
it is the path a persisted editor state takes on load.

### Not fixed here: strikethrough combined with inline code

The spec's edge-case list mentions code combined with strikethrough, and it is *not*
addressed, because it is unreachable from the export side. `convertDelete` in
`mdastToLexical.ts` calls `setFormat('strikethrough')`, which overwrites the whole bitmask
and erases the `code` bit on **import** — so no code+strikethrough node ever reaches the
mapper. The behaviour is stable (it loses formatting, but idempotently), fixing it would
change existing fixture output, and it is a genuinely separate defect. Tracked as
[#989](https://github.com/verveguy/liminis/issues/989); code+bold and code+italic work,
code+strikethrough does not, and the asymmetry is real rather than an oversight.

## The `callout/`, `toggle/`, `mermaid/`, and `c4/` fixture groups

Added by [#1](https://github.com/verveguy/liminis-editor/issues/1). Every fixture group
above is regression-shaped — named for the issue that produced it, added only after a
construct broke in front of a user. These four are the opposite: **feature-shaped**
coverage, organized by construct rather than by incident, for the four bespoke node
classes `editorNodes.ts` exports that had never had a single fixture exercising them —
`CalloutNode`, `ToggleContainerNode`/`ToggleTitleNode`/`ToggleContentNode`,
`MermaidNode`, and `C4Node`. `node-class-completeness.test.ts` (a sibling test file, not
part of this corpus) is the mechanism that keeps this from regressing back toward zero
coverage: it enumerates every class `editorNodes.ts` exports and fails, naming the
offending class, if any of them (outside its own documented exclusion list) has zero
fixtures anywhere in this directory constructing it.

Each group targets the same four shapes: a minimal instance, an instance nested inside a
list item (the one nesting context confirmed to round-trip correctly for all four — see
below), an instance with or adjacent to inline-formatted text, and an empty/degenerate
instance. Callout, mermaid, and c4 each have all four as `.md` fixtures in their own
directory; toggle has three — its nested-in-list-item shape is structurally unreachable
(see below) and is instead documented as a `known-defects/` fixture rather than a fourth
fixture in `toggle/`.

- **`callout/`**: `minimal.md`, `nested-in-list-item.md`, `inline-formatting.md`,
  `empty.md`. All four round-trip byte-identical. `inline-formatting.md` deliberately
  places its bold/italic/inline-code content in the callout's *second* paragraph, not
  its first line — see `known-defects/other-callout-first-line-inline-formatting-space-
  lost` above for why the first-line shape currently loses a space.
- **`toggle/`**: `minimal.md`, `inline-formatting.md`, `empty.md`, each with an
  `.expected.md` sidecar — `convertToggleContainerNode`'s export
  (`lexicalToMdast.ts`) always emits a blank line before the closing `</details>` tag
  regardless of whether the source had one, and its content is normalized to a single
  synthesized empty paragraph when content is absent. Both are stable, one-time
  canonicalizations (confirmed by the idempotence assertion), not data loss.
  `nested-in-list-item` is *not* one of the four fixtures in this group — see
  `known-defects/other-toggle-nested-in-list-item` above; a `<details>` block nested in
  a list item can never construct a real `ToggleContainerNode`, so covering that shape
  as if it worked would misrepresent the construct's actual support.
- **`mermaid/`**: `minimal.md`, `nested-in-list-item.md`, `adjacent-inline-formatting.md`
  (a paragraph with bold/italic/inline-code immediately before the diagram — the
  diagram's own body is opaque source text, not markdown prose, so inline formatting
  isn't meaningful *inside* it), `empty.md` (with `.expected.md`: a fenced block whose
  body is a single blank line normalizes to zero lines between the fences, a stable
  canonicalization).
- **`c4/`**: same four shapes as `mermaid/`, same empty-body canonicalization.

**Why "nested inside a list item," not a blockquote, for all four.** `convertQuoteNode`
(export, `lexicalToMdast.ts`) only converts a `QuoteNode`'s *inline* children — it has no
block-level dispatch fallback. Nesting a callout, toggle, mermaid, or C4 diagram directly
inside a blockquote would silently drop it, the same mechanism already documented at
`known-defects/other-blockquote-list-content-lost` above. `convertListItemNode`, by
contrast, has a full block-dispatch fallback and round-trips all four constructs
correctly when nested in a list item — confirmed for callout, mermaid, and c4 above;
toggle is the one exception, for the separate root-level-only detection reason described
in its own known-defects entry.

## Diagnosing a failure

On mismatch, the test throws with a unified diff between expected and actual content
(see `formatUnifiedDiff` in `../../roundtrip-test-utils.ts`), localized to the changed
lines rather than dumping both full blobs.

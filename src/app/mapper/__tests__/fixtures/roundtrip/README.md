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
- **`<name>.idempotence-exempt.txt`**: every fixture's round-tripped output (input-or-
  `.expected.md`, whichever applies) is itself round-tripped a second time with no edits,
  and that second pass must be byte-identical to the first (see "Idempotence" below). If a
  fixture's *first-pass* output is legitimately, pre-existingly non-idempotent for reasons
  unrelated to what the fixture is testing, add a sibling `.idempotence-exempt.txt`
  containing the reason; the suite skips the second-pass assertion for that fixture only.
  An exemption file that exists but is empty is a hard error — the reason is mandatory.
  This is not a general escape hatch — it exists for one documented case today (see the
  `902-list-item-double-hard-break*` section below).

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

Beyond matching its expected first-pass output, every fixture's output is round-tripped a
*second* time with no edits, and that second pass must be byte-identical to the first —
added by [#943](https://github.com/verveguy/liminis/issues/943) (FR-003/SC-002) to catch
drift that only shows up once a document is already in its round-tripped, canonical form.
This matters most for `.expected.md` fixtures: matching the sidecar on the first pass says
nothing about whether that sidecar's own content is itself a stable fixed point. See the
`.idempotence-exempt.txt` sidecar convention above for the documented, out-of-scope
exceptions.

**Every exemption in this corpus**, in full (there are five, all one pre-existing cause):

| Fixture | Reason |
| - | - |
| `902-list-item-double-hard-break` | #902's double-hard-break marker serializes as a whitespace-only line, which CommonMark re-reads as blank, splitting the paragraph on the second pass. Carries the full written reason. |
| `902-list-item-double-hard-break/double-break-adjacent-to-boundary` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/nested-list-double-break` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/task-list-double-break` | Same cause; cross-references the root sidecar. |
| `902-list-item-double-hard-break/triple-hard-breaks` | Same cause; cross-references the root sidecar. |

Fixing that underlying hard-break normalization is out of scope for #943 and needs its
own issue. No other fixture in the corpus is exempt, including all 22 in
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

Two fixtures added by [#943](https://github.com/verveguy/liminis/issues/943) beyond the
ported `50-*` set, pinning the half of the `join` override that deliberately did *not*
change — the corpus had no regression guard for it on either side:

- **`943-colon-paragraph-blank-line-before-table.md`** + `.expected.md`
- **`943-colon-paragraph-blank-line-before-math.md`** + `.expected.md`

Each is a colon-ending paragraph, a blank line, and a table or block-math node. Both
still canonicalize the blank line away, confirming the "label:" convention survives for
`table`/`code`/`math` while `list` no longer participates in it.

## Diagnosing a failure

On mismatch, the test throws with a unified diff between expected and actual content
(see `formatUnifiedDiff` in `../../roundtrip-test-utils.ts`), localized to the changed
lines rather than dumping both full blobs.

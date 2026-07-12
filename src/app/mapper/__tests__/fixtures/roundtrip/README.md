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
- **`other-*`**: additional round-trip fidelity losses discovered while building this
  corpus, for constructs the spec (FR-009) requires coverage of but that aren't part of
  the #897/#898 issue bodies: nested blockquotes (inner paragraphs collapse
  and nested quotes are hoisted out, mirroring the #897 mechanism at the blockquote
  level rather than the list-item level). Image alt text containing a bracket pair
  (e.g. `alt \[bracket\] text`) is also double-escaped by the bracket-preservation
  post-process step in `stringify.ts`, corrupting the image syntax further on a second
  round trip — discovered while adding #898 edge-case coverage but distinct from any of
  that issue's three defects.
  These are not tracked by a specific issue yet; if one is filed, rename the fixture to
  match the `NNN-*` convention above.
- **`other-titled-link-wikilink-url`**: a titled standard link whose URL is classified
  as a wiki-link by `isWikiLinkUrl` in `lexicalToMdast.ts` (relative `.md` paths,
  directory paths, and anchor-only URLs) is exported as a mdast `wikiLink` node instead
  of a `link` node. The `wikiLink` mdast type has no title concept, so the title is
  silently dropped even after [#904](https://github.com/verveguy/liminis/issues/904)
  fixed title round-tripping for standard `link` nodes. Pre-existing and orthogonal to
  #904 — the URL-shape-based link-vs-wiki-link classification, not title handling, is
  the root cause. Out of scope for #904 per its own spec, which only covers
  `https://...`-style URLs (never wiki-link-classified).
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

## Diagnosing a failure

On mismatch, the test throws with a unified diff between expected and actual content
(see `formatUnifiedDiff` in `../../roundtrip-test-utils.ts`), localized to the changed
lines rather than dumping both full blobs.

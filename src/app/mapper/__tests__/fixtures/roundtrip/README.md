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
  level rather than the list-item level), HTML blocks (attributes and tags stripped,
  leaving only inner text), and inline HTML (tags escaped as literal text).
  Image alt text containing a bracket pair (e.g. `alt \[bracket\] text`) is also
  double-escaped by the bracket-preservation post-process step in `stringify.ts`,
  corrupting the image syntax further on a second round trip — discovered while adding
  #898 edge-case coverage but distinct from any of that issue's three defects.
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
- **`other-list-item-double-hard-break`**: a residual gap in the #897 fix itself. That
  fix marks the boundary between two consecutive mdast paragraphs inside a list item by
  inserting two bare, adjacent `LineBreakNode`s (see `convertListItem` in
  `mdastToLexical.ts`), then detects that pair again on export to split back into two
  paragraphs. But a *single* mdast paragraph can itself contain two adjacent `break`
  nodes with no text between them — e.g. a line ending in `\` immediately followed by a
  line that is only `\` — which produces the exact same two-bare-adjacent-`LineBreakNode`
  shape and gets misread as the paragraph-boundary marker, splitting what should stay one
  paragraph (with two hard breaks) into two paragraphs. The same ambiguity is reachable
  purely by live editing too (pressing Shift+Enter twice in a row inside a list item with
  nothing typed between), independent of any markdown parsing. Content isn't lost — only
  reformatted — but this is a real, demonstrated gap in the "unambiguous sentinel" the fix
  relies on. Closing it properly needs a marker Lexical won't merge/garbage-collect (e.g.
  a dedicated custom node), which is a larger change than a conversion-function patch —
  see the "Plan B" contingency discussed for #897.
- **`other-strong-inline-math-not-wrapped`, `other-emphasis-footnote-not-wrapped`,
  `other-delete-inline-math-not-wrapped`**: discovered while fixing #898 review feedback
  that `convertStrong`/`convertEmphasis`/`convertDelete` in `mdastToLexical.ts` silently
  dropped `EquationNode`/`FootnoteNode`/`LineBreakNode` children (e.g. `**$x$**` or
  `_see note[^1]_` lost the math/footnote entirely). That data-loss bug is fixed — these
  nodes are now passed through unformatted rather than skipped — but a residual gap
  remains: only `TextNode` can carry Lexical's bold/italic/strikethrough format bits, so
  on export the equation/footnote node falls outside the mdast `strong`/`emphasis`/
  `delete` wrapper instead of staying nested inside it (`**$O(n)$ complexity**` round-trips
  to `$O(n)$** complexity**`). Content and order are preserved; only the marker span
  shifts. Closing this fully would mean giving non-text inline nodes a way to carry
  format state, a larger change than the data-loss fix itself.

## Diagnosing a failure

On mismatch, the test throws with a unified diff between expected and actual content
(see `formatUnifiedDiff` in `../../roundtrip-test-utils.ts`), localized to the changed
lines rather than dumping both full blobs.

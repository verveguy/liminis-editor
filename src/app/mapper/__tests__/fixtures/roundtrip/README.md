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
- **`898-*`**: reproduces [#898](https://github.com/verveguy/liminis/issues/898) — the
  serializer over-escapes inline content, degrades image-inside-link badges, and
  normalizes loose lists to tight lists.
- **`other-*`**: additional round-trip fidelity losses discovered while building this
  corpus, for constructs the spec (FR-009) requires coverage of but that aren't part of
  the #897/#898 issue bodies: definition lists (converted to bold-term + paragraph,
  losing the definition-list structure), nested blockquotes (inner paragraphs collapse
  and nested quotes are hoisted out, mirroring the #897 mechanism at the blockquote
  level rather than the list-item level), HTML blocks (attributes and tags stripped,
  leaving only inner text), and inline HTML (tags escaped as literal text). Table
  column alignment is also lost (`:---`, `:---:`, `----:` all collapse to plain `-`).
  These are not tracked by a specific issue yet; if one is filed, rename the fixture to
  match the `NNN-*` convention above.

## Diagnosing a failure

On mismatch, the test throws with a unified diff between expected and actual content
(see `formatUnifiedDiff` in `../../roundtrip-test-utils.ts`), localized to the changed
lines rather than dumping both full blobs.

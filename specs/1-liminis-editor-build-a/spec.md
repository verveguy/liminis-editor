# Feature Specification: Feature-shaped round-trip fixture corpus for `@liminis/editor`

**Feature Branch**: `fabrik/issue-1`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "`@liminis/editor` has 86 round-trip fixtures and they are all regressions. Every filename carries the issue number that produced it. The corpus therefore covers exactly the constructs that have already broken in front of a user, and nothing else. Build a feature-shaped corpus organised by construct, covering every node class in `editorNodes.ts`, with a completeness test that fails when a node class has no fixture exercising it."

## Background

`@liminis/editor`'s round-trip fixture corpus lives at
`src/app/mapper/__tests__/fixtures/roundtrip/`. Every fixture filename carries the issue
number that produced it (`50-`, `897-`, `902-`, `951-`, `973-`, …). The corpus therefore
covers exactly the constructs that have already broken in front of a user, and nothing
else — it is shaped by damage, not by feature surface.

That is the wrong shape for a package intended to be published and consumed by projects
this team does not control. It is also **how verveguy/liminis#973 happened**: emphasis or
strong containing an inline-code span is a basic construct, not an exotic edge case, and
it silently corrupted user documents on every save because no fixture had ever asserted
it. A feature-shaped corpus — organized by construct rather than by incident — would have
caught it before the first release. Once this package is published, the corpus doubles as
documentation: it becomes the answer to "does this editor handle callouts?" for someone
evaluating adoption, rather than a pile of regressions answering "what has broken here
before?"

Regression corpora only grow by damage — every new fixture is paid for by a user hitting
a bug. That is an acceptable way to *keep* coverage but a poor way to *get* it. Both
corpus shapes belong side by side: regressions pin past defects, features pin the
contract.

### Re-measured coverage (corrects the originating issue)

The issue that opened this work counted five node classes with zero fixture coverage.
Re-measuring against the corpus as it exists on this branch today (which has since
gained the `905-*` fixture set) shows one of the five is no longer accurate:

| construct | node class | fixtures today |
|---|---|---|
| Callout (`> [!NOTE]`) | `CalloutNode` | **0** |
| Toggle / `<details>` | `ToggleContainerNode`, `ToggleTitleNode`, `ToggleContentNode` | **0** |
| Mermaid | `MermaidNode` | **0** |
| C4 diagram | `C4Node` | **0** |
| Task list (`- [ ]` / `- [x]`) | `CustomListItemNode` (per-item checked state) | 4 (`ordered-task-list.md`, `905-adjacent-plain-and-task-list.md`, `905-mixed-loose-list.md`, `905-mixed-tight-list.md`) |

Task lists are already exercised — they no longer belong on the zero-coverage list. The
four bespoke, invented-by-this-package node types (`CalloutNode`, the three `Toggle*`
nodes, `MermaidNode`, `C4Node`) remain at genuine zero. This spec targets those four.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A completeness test stops the corpus drifting again (Priority: P1)

A maintainer adds a new node class to `editorNodes.ts` (or the corpus regresses back
toward zero coverage for an existing one, e.g. through fixture deletion) without adding a
round-trip fixture that exercises it. A test fails, naming the uncovered node class,
before the change can merge silently.

**Why this priority**: This is the mechanism that prevents the corpus from reverting to
"grows only by damage." Every other requirement in this spec closes today's gap; this one
keeps it closed. The issue itself calls this out as "the single most valuable part."

**Independent Test**: Temporarily remove every fixture that exercises one node class (or
run the test against a snapshot of the corpus predating this work) and confirm the
completeness test fails, naming that class.

**Acceptance Scenarios**:

1. **Given** the full set of node classes exported by `editorNodes.ts`, **When** the
   completeness test runs, **Then** it fails and names any class with zero exercising
   fixtures in the round-trip corpus.
2. **Given** a node class that is structurally unreachable through the
   `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`
   pipeline the corpus exercises (see Assumptions), **When** the completeness test runs,
   **Then** that class is excluded via an explicit, documented list rather than silently
   ignored or causing a false failure.
3. **Given** the corpus as it exists after this work lands, **When** the completeness
   test runs, **Then** it passes.

---

### User Story 2 - Callout gets feature coverage (Priority: P1)

A contributor or evaluator wants to know whether `@liminis/editor` supports GitHub-style
callouts (`> [!NOTE]`, `> [!WARNING]`, etc.). The feature corpus contains fixtures that
answer that question directly: a minimal callout, a callout nested inside a list item,
a callout whose body contains inline formatting (bold/italic/inline-code — the shape
#973 broke), and an empty callout (marker with no body), each round-tripping to a fixed
point or explicitly filed under `known-defects/` with a documented reason.

**Why this priority**: Callout is one of the four constructs this package invented that
has never been exercised by any fixture.

**Independent Test**: Round-trip each new callout fixture and assert it reaches a fixed
point (second pass equals first), per the existing corpus harness.

**Acceptance Scenarios**:

1. **Given** a minimal callout (`> [!NOTE]\n> Text.`), **When** it is round-tripped,
   **Then** the construct and its type survive and the output reaches a fixed point.
2. **Given** a callout nested inside a list item, **When** it is round-tripped, **Then**
   the nesting and the callout both survive (or, if this reproduces a pre-existing known
   defect such as the blockquote/list-item content loss documented in
   `known-defects/other-blockquote-list-content-lost`, the fixture is filed under
   `known-defects/` with that reason rather than silently passing on lossy output).
3. **Given** a callout whose body contains bold, italic, or inline-code text, **When** it
   is round-tripped, **Then** the inline formatting survives inside the callout body.
4. **Given** a callout with a type marker and no body text, **When** it is round-tripped,
   **Then** it reaches a fixed point (or is filed under `known-defects/` with a reason).

---

### User Story 3 - Toggle gets feature coverage (Priority: P1)

Same shape as User Story 2, for the toggle/`<details>` construct
(`ToggleContainerNode`/`ToggleTitleNode`/`ToggleContentNode`): minimal, nested inside a
list item or blockquote where legal, containing inline-formatted text, and an empty
toggle (no body content between summary and close tag).

**Why this priority**: Toggle is one of the four zero-coverage bespoke constructs.

**Independent Test**: Same as User Story 2, applied to toggle fixtures.

**Acceptance Scenarios**:

1. **Given** a minimal toggle (`<details><summary>Title</summary>\n\nBody.\n\n</details>`),
   **When** it is round-tripped, **Then** the title/content split survives and the output
   reaches a fixed point (or is filed under `known-defects/` with a reason).
2. **Given** a toggle nested inside a list item or blockquote, **When** it is
   round-tripped, **Then** the nesting and toggle structure both survive (or the fixture
   is filed under `known-defects/` with a reason).
3. **Given** toggle content containing bold, italic, or inline-code text, **When** it is
   round-tripped, **Then** the inline formatting survives.
4. **Given** a toggle with an empty content section, **When** it is round-tripped,
   **Then** it reaches a fixed point (or is filed under `known-defects/` with a reason).

---

### User Story 4 - Mermaid gets feature coverage (Priority: P1)

Same shape as User Story 2, for `MermaidNode`: a minimal Mermaid diagram, one nested
inside a list item or blockquote where legal, one adjacent to a paragraph containing
inline formatting (the diagram body itself is opaque source text, not markdown prose, so
"adjacent to inline formatting" is satisfied at the block level rather than inside the
diagram body), and an empty/degenerate diagram body.

**Why this priority**: Mermaid is one of the four zero-coverage bespoke constructs.

**Independent Test**: Same as User Story 2, applied to Mermaid fixtures.

**Acceptance Scenarios**:

1. **Given** a minimal fenced Mermaid diagram, **When** it is round-tripped, **Then** the
   diagram source and node type survive and the output reaches a fixed point (or is filed
   under `known-defects/` with a reason).
2. **Given** a Mermaid diagram nested inside a list item or blockquote, **When** it is
   round-tripped, **Then** the nesting and diagram both survive (or the fixture is filed
   under `known-defects/` with a reason).
3. **Given** a Mermaid diagram immediately adjacent to a paragraph containing inline
   formatting, **When** it is round-tripped, **Then** both the diagram and the paragraph's
   formatting survive.
4. **Given** a fenced Mermaid block with an empty or whitespace-only body, **When** it is
   round-tripped, **Then** it reaches a fixed point (or is filed under `known-defects/`
   with a reason).

---

### User Story 5 - C4 diagram gets feature coverage (Priority: P1)

Same shape as User Story 4, for `C4Node`.

**Why this priority**: C4 is the last of the four zero-coverage bespoke constructs.

**Independent Test**: Same as User Story 2, applied to C4 fixtures.

**Acceptance Scenarios**:

1. **Given** a minimal fenced C4 diagram, **When** it is round-tripped, **Then** the
   diagram source and node type survive and the output reaches a fixed point (or is filed
   under `known-defects/` with a reason).
2. **Given** a C4 diagram nested inside a list item or blockquote, **When** it is
   round-tripped, **Then** the nesting and diagram both survive (or the fixture is filed
   under `known-defects/` with a reason).
3. **Given** a C4 diagram immediately adjacent to a paragraph containing inline
   formatting, **When** it is round-tripped, **Then** both the diagram and the paragraph's
   formatting survive.
4. **Given** a fenced C4 block with an empty or whitespace-only body, **When** it is
   round-tripped, **Then** it reaches a fixed point (or is filed under `known-defects/`
   with a reason).

---

### Edge Cases

- A construct's "nested inside another block" shape is only required where that nesting
  is legal Markdown/mdast — e.g. GFM table cells carry inline content only, so none of
  the four constructs in scope get a table-cell nesting fixture.
- A fixture that reveals a genuine, pre-existing fidelity loss (not introduced by this
  work) is filed under `known-defects/` with a documented reason and an `.expected.md`
  capturing the actual (defective) output, per the corpus's existing convention — it is
  not silently accepted as passing, and it is not fixed as part of this issue unless the
  fix is trivial and clearly in-scope.
- Every fixture added here (features and any incidentally-touched sidecar files) follows
  the corpus's existing idempotence rule: successful fixtures get a second round trip
  asserted byte-identical to the first, unless carrying a documented
  `.idempotence-exempt.txt`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A completeness test MUST enumerate the node classes exported by
  `src/app/editor/editorNodes.ts` and fail, naming the offending class, if any class
  outside the documented exclusion list (FR-002) has zero fixtures exercising it in the
  round-trip corpus.
- **FR-002**: The completeness test MUST carry an explicit, documented exclusion list for
  node classes that cannot be produced by the
  `parseMarkdown → importMarkdownToLexical → exportLexicalToMdast → stringifyMarkdown`
  pipeline the corpus exercises — today that is `MarkNode` (created only by the live
  annotation feature), `AutoLinkNode` (created only by the live `LinkPlugin` autolink
  behavior), and `CodeHighlightNode` (created only by the live `registerCodeHighlighting`
  plugin). The list MUST be revisited, not silently extended, if a future node class is
  added.
- **FR-003**: The feature corpus MUST add fixtures for `CalloutNode` covering, at
  minimum: a minimal instance, an instance nested inside a list item (or another block
  where legal), an instance containing inline-formatted text, and an empty/degenerate
  instance.
- **FR-004**: The feature corpus MUST add fixtures for `ToggleContainerNode` /
  `ToggleTitleNode` / `ToggleContentNode` covering the same four shapes as FR-003.
- **FR-005**: The feature corpus MUST add fixtures for `MermaidNode` covering the same
  four shapes as FR-003, adapted per the Mermaid entries in User Story 4.
- **FR-006**: The feature corpus MUST add fixtures for `C4Node` covering the same four
  shapes as FR-003, adapted per the C4 entries in User Story 5.
- **FR-007**: Every fixture added under FR-003 through FR-006 MUST reach a round-trip
  fixed point (second pass byte-identical to first pass) or be explicitly filed under
  `known-defects/` with a documented reason and `.expected.md`, following the corpus's
  existing convention (see `fixtures/roundtrip/README.md`).
- **FR-008**: No existing round-trip fixture may be added to, removed, or altered other
  than the new fixtures required by FR-003 through FR-006, and no fixture currently
  classified under `known-defects/` may change classification.
- **FR-009**: The new feature fixtures MUST be organized by construct (e.g. grouped
  under a callout/toggle/mermaid/c4 subdivision) so the corpus's directory structure
  itself communicates "which constructs are covered," distinct from the existing
  issue-numbered regression fixtures.

### Key Entities

- **Round-trip fixture**: a Markdown file in the corpus, optionally paired with an
  `.expected.md` (normalized/defective output), `.error.txt`, `.idempotence-exempt.txt`,
  or `.export-options.json` sidecar, per `fixtures/roundtrip/README.md`.
- **Feature-shaped fixture**: a fixture whose purpose is to document that a supported
  construct works — named and organized by the construct it exercises — as distinct from
  a regression-shaped fixture, which pins a specific historical defect and is named for
  the issue that produced it. Both live in the same corpus and are discovered by the same
  test.
- **Editor node class**: a class listed in `src/app/editor/editorNodes.ts`'s
  `editorNodes` array — the completeness test's coverage universe, minus the FR-002
  exclusion list.
- **Zero-coverage construct**: a node class with no fixture, anywhere in the corpus
  (regression or feature), whose import produces at least one instance of that class.
  Today: `CalloutNode`, `ToggleContainerNode`, `ToggleTitleNode`, `ToggleContentNode`,
  `MermaidNode`, `C4Node`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The completeness test (FR-001/FR-002) fails when run against the corpus
  as it exists before this work, naming `CalloutNode`, `ToggleContainerNode`,
  `ToggleTitleNode`, `ToggleContentNode`, `MermaidNode`, and `C4Node`, and passes once
  the fixtures required by FR-003 through FR-006 are added.
- **SC-002**: Each of Callout, Toggle, Mermaid, and C4 has at least one fixture for each
  of the four shapes (minimal / nested-where-legal / adjacent-to-inline-formatting /
  empty-or-degenerate-where-representable).
- **SC-003**: Every fixture in the corpus — pre-existing and newly added — reaches a
  round-trip fixed point or is explicitly classified under `known-defects/` with a
  documented reason; no `known-defects/` fixture changes classification.
- **SC-004**: No pre-existing round-trip fixture's content changes.
- **SC-005**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` all pass.

## Assumptions

- **Scope of the four-shape requirement**: applied to the four constructs that are
  genuinely at zero coverage today (Callout, Toggle, Mermaid, C4). Retrofitting the same
  four-shape treatment onto constructs that already have at least one fixture (tables,
  images, footnotes, raw HTML, wiki-links, math, definition lists, strikethrough,
  horizontal rules, task lists, etc.) is not required by this issue — those already
  satisfy the completeness test's "at least one fixture" bar, and auditing each for
  full shape coverage is a larger, separable effort better suited to its own follow-up
  issue (see Out of Scope).
- **Task lists are out of scope for new fixtures**: the originating issue counted them
  as zero-coverage; re-measurement against this branch shows 4 existing fixtures already
  exercise per-item checked state (`ordered-task-list.md`, three `905-*` fixtures). No
  new task-list fixtures are required by this spec.
- **Exclusion list for the completeness test**: `MarkNode`, `AutoLinkNode`, and
  `CodeHighlightNode` are registered in `editorNodes.ts` so the live editor's plugins
  (`registerCodeHighlighting`, `LinkPlugin`, the annotation feature) can construct them
  during interactive editing, but none of the three is ever created by
  `importMarkdownToLexical` — confirmed by inspecting `mdastToLexical.ts`, which
  contains no reference to any of them. A markdown-fixture-driven completeness test can
  therefore never exercise them structurally; FR-002 requires them excluded explicitly
  and by name rather than the test being weakened generically or made to fail
  permanently on unreachable classes.
- **Fixture placement**: new feature fixtures live under the corpus's existing
  `fixtures/roundtrip/` tree (so the existing auto-discovering
  `fixture-roundtrip.test.ts` picks them up with no code change) using the corpus's
  existing sidecar conventions (`.expected.md`, `.idempotence-exempt.txt`, etc., per
  `fixtures/roundtrip/README.md`). Exact subdirectory naming is a Research/Plan-stage
  decision.
- **`known-defects/` is a legitimate outcome, not a fallback to avoid**: if building a
  feature fixture surfaces a genuine, pre-existing fidelity loss for one of the four
  constructs, filing it under `known-defects/` with a documented reason satisfies FR-007;
  this issue does not require fixing every defect it uncovers, consistent with how the
  existing corpus treats known defects.

## Out of Scope

- Retrofitting four-shape (minimal/nested/inline-adjacent/empty) coverage onto
  constructs that already have at least one fixture today.
- Fixing any round-trip fidelity defect uncovered while building the new fixtures,
  beyond filing it under `known-defects/` with a documented reason — unless the fix is
  trivial and clearly within this issue's boundary.
- Any change to Markdown parsing or serialization behavior; this issue only adds test
  fixtures and a completeness test.
- Publishing the package or generating consumer-facing documentation from the corpus.
- The vendored real-document suite (`issue-973-adr-idempotence.test.ts` and
  `fixtures/real-documents/`) — unrelated to this issue.
- Any node class not currently listed in `src/app/editor/editorNodes.ts`.

## Source References

- `src/app/editor/editorNodes.ts` — the single source of truth for "all supported node
  classes," per its own docstring (ADR-075).
- `src/app/mapper/__tests__/fixtures/roundtrip/` — the existing fixture corpus, and its
  `README.md` documenting fixture/sidecar conventions.
- `src/app/mapper/__tests__/fixture-roundtrip.test.ts` — the auto-discovering test that
  runs every fixture; the completeness test required by FR-001 is new and separate from
  this file's per-fixture round-trip assertions.
- `src/app/mapper/__tests__/roundtrip-test-utils.ts` — corpus harness, including
  `.expected.md`, `.idempotence-exempt.txt`, `.error.txt`, and `.export-options.json`
  sidecar handling.
- `src/app/editor/nodes/CalloutNode.ts`, `ToggleNode.tsx`, `MermaidNode.tsx`,
  `C4Node.tsx` — the four node classes this spec targets.
- `src/app/mapper/mdastToLexical.ts` — confirms `MarkNode`/`AutoLinkNode`/
  `CodeHighlightNode` are never constructed by markdown import.
- verveguy/liminis#973 — the defect this corpus shape allowed; its `973-*` fixtures stay
  regression-shaped.

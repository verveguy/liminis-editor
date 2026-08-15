# Feature Specification: Export the editor node set so consumers can build a headless editor

**Feature Branch**: `fabrik/issue-954`
**Created**: 2026-08-06
**Status**: Draft
**Input**: User description: "`@liminis/editor`: export the editor node set so consumers can build a headless editor — `@liminis/editor` exports `parseMarkdown`, `stringifyMarkdown`, `importMarkdownToLexical` and `exportLexicalToMdast`, but no Lexical node classes and no aggregate node array. A consumer therefore cannot construct a headless Lexical editor configured with the package's nodes, and so cannot exercise the markdown↔Lexical mapper."

## Background

`@liminis/editor` already exports the markdown↔Lexical mapper functions (`importMarkdownToLexical`, `exportLexicalToMdast`) alongside the pure-markdown functions (`parseMarkdown`, `stringifyMarkdown`), but it does not export the Lexical node classes — or the aggregate array of them — that the production editor configures its `LexicalComposer` with. Without that array, a consumer cannot call Lexical's `createEditor({ nodes: [...] })` and get a working editor: any node type Lexical encounters that isn't in that array throws.

This matters because the markdown↔Lexical mapper is where round-trip fidelity bugs actually live. Two real defects (`verveguy/zusammen#62` and its predecessor `#50`, upstreamed to this package as `#943`) were both mapper bugs — cases where markdown parsed into Lexical nodes and serialized back out lost or corrupted content. A regression guard that doesn't exercise the mapper doesn't catch this class of bug.

Today, a consumer of `@liminis/editor` who wants that guard has two bad options:
1. Mount the full React `<Editor>` component under a DOM shim — slow, and it pulls MathJax, Mermaid, and Prism into a test that needs none of them, because those are wired into the production editor's node classes and plugins.
2. Test only `parseMarkdown` → `stringifyMarkdown` — which never touches Lexical at all, so it skips the mapper entirely.

The production editor's own node array already exists — it lives as an unexported `const editorNodes` local to `packages/editor/src/app/editor/Editor.tsx`, passed directly into its `LexicalComposer`'s `initialConfig.nodes`. It is not reachable from outside the file. The package's own test suite already worked around this: `packages/editor/src/app/mapper/__tests__/roundtrip-test-utils.ts` hand-maintains a second copy of the same list (with a comment noting it must be kept "matching Editor.tsx") so its headless round-trip tests can build a `createEditor` instance. That second list is exactly the kind of parallel, driftable copy this issue exists to eliminate — nothing enforces that the two arrays stay identical, and several other internal test files (list-shortcut tests, annotation tests) already depend on this same hand-copied array via that file.

The package declares five entry points today (`package.json` `exports`): the root barrel (`.`), `./markdown`, `./annotations`, `./headless`, and `./contract`. The mapper functions are currently reachable only from the root barrel, whose import graph includes the full `<App>`/`<Editor>` React components, MathJax, Mermaid, and Prism — the same weight the issue's "mount the full editor" workaround is trying to avoid. `./markdown` and `./contract` (the two entry points the issue's Ask suggests as candidates) are each documented, in their own file header and via ADR-075, as deliberately excluding Lexical, React, and the DOM — so whichever entry point ends up carrying the node classes and a lighter path to the mapper functions needs to either be a new entry point or a documented, deliberate widening of an existing one's contract. This spec does not decide which; see Assumptions.

This is one of four small upstream gaps identified while scoping a private git-dependency adoption of `@liminis/editor` by `verveguy/zusammen` (that adoption is tracked as `verveguy/zusammen#102`, the parent of this issue). That adoption deletes a 77-file fork whose own round-trip harness built a headless editor from 28 hand-listed node classes; this export is what lets the equivalent regression guard survive as a dependency consumer instead of a fork. It is the smallest of the four gaps, and the only one that is purely additive — no existing behavior changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a headless editor to test the markdown↔Lexical mapper (Priority: P1)

A downstream consumer of `@liminis/editor` (for example, `verveguy/zusammen`, or the package's own internal test suite) wants a fast regression test that exercises the real markdown → Lexical → markdown round trip, without paying the cost of mounting the full React editor or pulling in MathJax/Mermaid/Prism. Importing only from `@liminis/editor`'s declared entry points, the consumer constructs a headless Lexical editor configured with the exact node set the production editor uses, feeds it markdown through `importMarkdownToLexical`, reads the result back out with `exportLexicalToMdast`, and asserts the round trip is correct.

**Why this priority**: This is the entire purpose of the issue. Without it, a consumer either pays for the full editor's weight or can't reach the mapper layer at all — and the mapper layer is where the fidelity bugs this guard is meant to catch have actually occurred.

**Independent Test**: Write a test that imports only from `@liminis/editor`'s declared entry points (no deep/internal paths), builds a headless editor with the exported node array, runs a markdown string through `importMarkdownToLexical` then `exportLexicalToMdast`, and asserts the round-tripped output is correct.

**Acceptance Scenarios**:

1. **Given** only `@liminis/editor`'s declared entry points are imported, **When** a consumer passes the exported node array to Lexical's `createEditor`, **Then** the editor is constructed successfully and accepts every node type the production editor is configured with — no missing-node registration error for any node type the mapper can produce.
2. **Given** that headless editor, **When** the consumer calls `importMarkdownToLexical` with parsed markdown covering a representative sample of node types (headings, lists, tables, code, links, images, callouts, etc.) and then calls `exportLexicalToMdast`, **Then** the resulting mdast round-trips correctly.
3. **Given** the round trip in Scenario 2, **When** it runs, **Then** no MathJax, Mermaid, or Prism initialization occurs, and no more DOM is required than the mapper's existing HTML-passthrough path already needs.
4. **Given** a new node type is added to the production editor's own Lexical composer configuration, **When** the package is next built or imported, **Then** the exported node array includes the new node type automatically — no second, manually-maintained list needs a matching edit.

---

### Edge Cases

- Several node classes in the production array are Lexical `DecoratorNode`s whose visual rendering is backed by a React component (images, equations, diagrams, Mermaid). Those node classes must still construct and register on `createEditor`, and participate correctly in `importMarkdownToLexical`/`exportLexicalToMdast`, without requiring their decorator component to actually render.
- The two entry points the original issue names as candidates (`./contract`, `./markdown`) currently carry documented no-Lexical/no-DOM contracts (their own file header comments, and ADR-075 for `./markdown`). Whichever entry point ultimately carries this export must not silently break that documented contract for that entry point's existing consumers.
- If the mapper's HTML-passthrough path relies on real DOM parsing (rather than a pure string fallback) for some content, the headless test environment needs whatever minimal DOM that path already required today — no more than that, and no less.
- The package's own internal tests already hand-maintain a duplicate of the node array (`roundtrip-test-utils.ts`) and several other internal tests transitively depend on that duplicate. The new public export must be able to replace that duplicate without changing what those internal tests verify.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package MUST export, from at least one declared entry point (a subpath listed in `package.json`'s `exports` map), the array of Lexical node classes used to configure the production editor's `LexicalComposer`.
- **FR-002**: The exported node array MUST be derived from a single shared source also used by the production editor's own configuration — either the editor imports the same array that is exported, or the export re-exports the editor's array directly. A separately hand-maintained copy of the list does not satisfy this requirement, because it can silently drift from the array the editor actually uses.
- **FR-003**: The package MUST export `importMarkdownToLexical` and `exportLexicalToMdast` from a declared entry point whose import graph does not require the `<App>`/`<Editor>` React UI components, MathJax, Mermaid, or Prism.
- **FR-004**: A consumer importing only from the package's declared entry points MUST be able to construct a working headless Lexical editor (via Lexical's `createEditor`) using the exported node array, without mounting any React component and without more browser DOM than the mapper's existing HTML-passthrough path already requires.
- **FR-005**: Running `importMarkdownToLexical` followed by `exportLexicalToMdast` against that headless editor MUST produce correct round-trip output for markdown exercising the exported node set, at the same fidelity the package's existing internal round-trip tests already verify.
- **FR-006**: The package's own test suite MUST include a test that imports only from its declared entry points (not internal/deep paths), builds a headless editor from the exported node array, and asserts a markdown → Lexical → mdast round trip succeeds — demonstrating the public export is sufficient on its own, with no reliance on package-internal helpers.
- **FR-007**: Any existing internal test helper that currently hand-maintains its own copy of the editor's node list MUST be updated to consume the new public export instead, removing the duplicate list.
- **FR-008**: This change MUST be purely additive: it MUST NOT alter which nodes the production editor is configured with, and MUST NOT change markdown↔Lexical mapping or serialization behavior for any existing consumer.

### Key Entities

- **Editor node array**: The ordered list of Lexical node classes the production editor passes to `LexicalComposer`'s `initialConfig.nodes` — the single source of truth this issue makes reachable from outside the package.
- **Declared entry point**: A subpath listed in `@liminis/editor`'s `package.json` `exports` map (e.g. `./markdown`, `./contract`, or a new subpath) — the only supported way for a consumer to import from this package, per the package's own existing "never a deep import" convention.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A consumer, importing only from the package's declared entry points, can construct a headless Lexical editor configured with every node type the production editor uses.
- **SC-002**: That headless editor, driven only through the public `importMarkdownToLexical` / `exportLexicalToMdast` exports, round-trips markdown content covering all currently-supported node types with correct output.
- **SC-003**: Building and driving that headless editor initializes no MathJax, Mermaid, or Prism machinery, and requires no more DOM than the mapper's existing HTML-passthrough path already needs.
- **SC-004**: Adding a new node type to the production editor's configuration requires editing exactly one place; the public export reflects the change automatically, with no second list to update anywhere in the package.
- **SC-005**: A test exercising the full round trip through the public export exists in the package's test suite and passes in CI.

## Assumptions

- The exact declared entry point that will carry this export — an existing one repurposed and re-documented, or a new one added to `package.json`'s `exports` map — is left to the Research/Plan stages. This spec requires only that some declared entry point satisfies the Functional Requirements above without silently breaking another entry point's existing documented contract (see Edge Cases).
- "Correct round-trip output" (FR-005, SC-002) means output consistent with the standard the package's existing internal round-trip test suite already applies (byte-identical or fixture-verified, per its established conventions) — this issue does not raise or redefine that fidelity bar, it only makes it reachable from outside the package.
- Decorator nodes whose visual rendering depends on a React component (images, equations, diagrams, Mermaid) only need to construct and participate in markdown↔Lexical mapping headlessly for this issue. Actually rendering their decorator UI in a headless environment is out of scope — the production `<Editor>` already covers that.
- Once published, this export becomes part of the package's public, semver-relevant surface — the same convention its other declared entry points (`./markdown`, `./headless`, `./contract`) already follow.

## Out of Scope

- Changing which nodes the production editor is configured with.
- Any change to markdown↔Lexical mapping or serialization behavior or fidelity.
- Actually wiring `verveguy/zusammen` to consume this export as a dependency — that is the parent issue's (`verveguy/zusammen#102`) own follow-up work.
- The other three upstream gaps referenced in the issue's Context section — each is tracked separately.
- Rendering decorator nodes' React UI in a headless environment.

## Source References

- `packages/editor/src/app/editor/Editor.tsx` (production `editorNodes` array and its use in `LexicalComposer`'s `initialConfig`)
- `packages/editor/src/app/mapper/__tests__/roundtrip-test-utils.ts` (existing hand-duplicated copy of the node array — the drift risk this issue eliminates — and several other internal tests that depend on it)
- `packages/editor/src/app/mapper/index.ts` (re-exports `importMarkdownToLexical`, `exportLexicalToMdast`)
- `packages/editor/src/index.ts` (root barrel; currently the only declared entry point that exports the mapper functions)
- `packages/editor/src/markdown.ts`, `packages/editor/src/contract.ts` (existing entry points named in the issue's Ask, each documented as Lexical/DOM-free)
- `packages/editor/package.json` (`exports` map)
- Related: `verveguy/zusammen#102` (parent issue), `verveguy/zusammen#62` and `#50`, `#943` (mapper fidelity bugs this guard is meant to catch), ADR-075

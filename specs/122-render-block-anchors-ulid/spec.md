# Feature Specification: Render block anchors (`^ULID`) as a badge instead of raw text

**Feature Branch**: `fabrik/issue-122`
**Created**: 2026-09-09
**Status**: Specified
**Input**: User description: "Render a block anchor (`^ULID`) as a compact badge at its definition site instead of raw text, now that 0.5.0 makes anchors meaningful as link and transclusion targets (`[[file#^id]]`, `![[file#^id]]`); the underlying markdown, and the id itself, must stay exactly as authored."

## Background

Block anchors (`^ULID`) are actively used in Liminis notes — produced in the
course of actions work and written into markdown as literal text, most
heavily on action-item checkboxes:

```markdown
- [ ] @me Draft the boundary doc by 2026-09-15 ^01M00VDX0S4JHMDNA7F776Y8R8
```

The editor currently renders them **as raw text**: a reader sees
`^01J9XQZ4K7MJ8TQVF3N2WBRC5D` sitting inline in the prose.

Now that 0.5.0 makes those anchors meaningful as link and transclusion
targets (`[[file#^id]]`, `![[file#^id]]` — see
`specs/119-support-obsidian-style-block/spec.md`), showing the raw ULID is
doubly unhelpful: it is visual noise, and it offers no affordance for the
capability it now enables.

This issue covers how an anchor renders **at its own definition site**. The
host-side counterpart — resolving `file#^id` to content — is
verveguy/liminis#1109. The two are independent: neither blocks the other.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An anchor reads as a marker, not as noise (Priority: P1)

A reader opens a note containing block anchors. Instead of 26 characters of
raw ULID interrupting the prose, each anchor appears as a compact badge.

**Why this priority**: This is the reported problem — anchors are already in
real notes, degrading readability of every document that uses them.

**Independent Test**: Render a document containing one or more `^ULID`
block anchors and verify each one displays as a compact badge rather than
the literal caret+id text, that each renders independently, and that the
surrounding prose is otherwise unaffected.

**Acceptance Scenarios**:

1. **Given** a note containing a block anchor, **When** it renders, **Then**
   the anchor appears as a badge rather than the literal `^ULID` string.
2. **Given** a note containing several anchors, **When** it renders, **Then**
   each renders independently and surrounding prose is unaffected.

---

### User Story 2 - The id remains usable (Priority: P1)

A user building a `[[file#^id]]` reference needs the id of an existing
anchor.

**Why this priority**: Anchors exist to be referenced. A badge that hides
the id without offering it back would break the workflow it is meant to
serve — making the feature a net regression.

**Independent Test**: From a rendered anchor badge, retrieve the id via
hover, selection, or an equivalent affordance, and verify the retrieved
text matches the id exactly as written in the source markdown.

**Acceptance Scenarios**:

1. **Given** a rendered anchor badge, **When** the user seeks the id
   (hover, selection, or an equivalent affordance), **Then** the full id is
   available.
2. **Given** the full id is shown, **When** the user copies it, **Then**
   they obtain the exact id as written on disk.

---

### User Story 3 - The document is unchanged (Priority: P1)

**Why this priority**: This is a display concern. A rendering change that
alters bytes on disk is a data-integrity bug, and anchors are referenced by
exact id — a single altered character breaks every reference to that block.

**Independent Test**: Parse a document containing anchors and re-serialize
it via `stringifyMarkdown`; diff against the original and verify it is
byte-identical. Separately, edit and delete an anchor in an open editor and
verify both operations behave like ordinary text editing.

**Acceptance Scenarios**:

1. **Given** a note containing anchors, **When** it is parsed and
   stringified, **Then** the output is byte-identical to the input.
2. **Given** an anchor in an open document, **When** the user edits or
   deletes it, **Then** that works normally — the badge is not a trap
   requiring the file be edited elsewhere.

---

### Edge Cases

- **A caret that is not an anchor** — maths, code spans, inline code. An
  anchor inside a fenced or inline code block must render as literal text.
- **An anchor adjacent to other inline syntax** — immediately after a link,
  inside emphasis, at a line start or end.
- **A malformed or truncated id** — should render as text rather than a
  badge, not throw.
- **Anchors in a headless/`parseMarkdown`-only context** with no editor
  mounted — the pipeline must behave identically.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A block anchor displays as a compact badge rather than the
  literal `^ULID` string.
- **FR-002**: The underlying markdown is unchanged. `parseMarkdown` /
  `stringifyMarkdown` round-tripping MUST preserve the anchor exactly as
  authored.
- **FR-003**: The full id remains available to the reader on demand and is
  copyable.
- **FR-004**: Anchors remain editable and deletable in the editor.
- **FR-005**: Detection MUST match the anchor convention as actually
  written in real notes. Verify against one; do not derive the pattern from
  this issue's example, and do not match a bare `\^\w+`.
- **FR-006**: The new inline matcher MUST NOT weaken existing wiki-link or
  embed-marker detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A note containing `^ULID` renders it as a badge, not raw
  text.
- **SC-002**: Parse → stringify of that note is byte-identical to the
  input.
- **SC-003**: The full id can be read and copied from the badge.
- **SC-004**: Prose containing a non-anchor caret (`2^10`, `x^2`, `a ^ b`)
  is untouched.
- **SC-005**: Existing wiki-link and transclusion rendering is unchanged,
  evidenced by the existing markdown-pipeline fixtures still passing.

## Assumptions

- The anchor convention is stable and already present in real notebooks;
  this issue renders it rather than defining it.
- The badge is presentation only — no persistence, no new node type in the
  serialized markdown.

## Out of Scope

- Host-side resolution of `file#^id` to content — verveguy/liminis#1109.
- Authoring UI for creating anchors.
- **Surfacing linkedness** (indicating that other notes reference this
  anchor). Attractive, but it needs a backlink index the editor does not
  have. Recommend keeping this issue to presentation only and treating any
  reference-count affordance as a separate decision.

## Guards

- `docs/markdown-pipeline.md`'s "Block-scoped links and transclusion"
  section (`## Block-scoped links and transclusion (#119)`) documents the
  embed-marker (`![[...]]`) substitution in `src/markdown/parse.ts` as
  load-bearing on a "complete span, no internal `]`" condition, guarded by
  the `903-image-alt-leading-bracket` round-trip fixture
  (`src/app/mapper/__tests__/fixtures/roundtrip/903-image-alt-leading-bracket.md`).
  The same caution applies to any new inline matcher added for block-anchor
  detection: check that section and its regression fixture before changing
  the parser, and confirm the new matcher does not interact with the
  sentinel-substitution approach used there.

## Source References

- `specs/119-support-obsidian-style-block/spec.md` — the companion feature
  (`[[file#^id]]` links and `![[file#^id]]` transclusion) that makes
  anchors meaningful as reference targets, and the source of the real
  `^ULID` action-item example above.
- `docs/markdown-pipeline.md` — wiki-link and embed-marker parsing
  precedent, and this package's round-trip contract.
- `src/markdown/parse.ts`, `src/markdown/stringify.ts` — where a new
  inline anchor matcher would live.

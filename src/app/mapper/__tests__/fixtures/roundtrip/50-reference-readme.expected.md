# Liminis

Liminis is a markdown-native knowledge workspace for people who think in documents, built on a
Lexical WYSIWYG editor and a knowledge graph. It lets an author open a note, write in rich text,
and have the result stay plain canonical markdown on disk — all without ever leaving the editor
or hand-editing serialized output.

This document is a synthetic reference document for the round-trip idempotence corpus (see
[#943](https://github.com/verveguy/liminis/issues/943)). It exercises the representative corpus's
constructs — paragraphs, tight and loose lists, a list following a block with an intervening
blank line, headings, blockquotes, fenced code blocks, tables, nested lists, and runs of multiple
blank lines — at a realistic document scale (approximately 13.8 KB), including the exact phrase from the
originally reported defect.

## Why Liminis exists

Knowledge workers write a lot of prose: specs, design docs, meeting notes, research summaries.
Most of that writing ends up trapped in whatever tool produced it — a proprietary note app, a
wiki, a scratch file — none of which are durable or greppable. Liminis closes that gap by
making the plain markdown file on disk the source of truth.

Support the ecosystem by:

- **Underline** important things readers should not miss
- Link a note to another without leaving the document
- Promote a draft into the permanent collection as thinking settles
- Keep every note in plain markdown, even as the workspace grows around it

## Installation

Steps to get started:

1. Clone the repository
2. Install dependencies with `pnpm install`
3. Run `pnpm dev` from the repository root
4. Open a markdown notebook directory from anywhere on disk

### Prerequisites

Before installing, confirm the following:

- Node 22 or newer
- pnpm as the package manager
- A notebook directory to open (Liminis does not create one for you)

## Core concepts

### Notes

> Notes live as ordinary `.md` files in a workspace directory that is never hidden from you. This
> keeps the notebook portable and the working tree exactly what the author expects to see.

A note is addressed by the exact text of its title, not by an internal identifier or database
row. When the underlying workspace changes, the link resolver re-evaluates each wiki link against
the new state and classifies the outcome as one of four states:

- `unchanged` — the linked note is still present, byte-for-byte
- `re-attached` — the note moved but is still recognizably the same file
- `flagged` — the note changed enough that a human should double check the link
- `orphaned` — the linked note is gone; the link stays in the text but has no live target

### Extraction

When a note is saved and its prose has changed materially, Liminis's extraction pipeline
tries to derive graph entities automatically:
```js
function extract(base, previous, current) {
  const derived = deriveNonOverlapping(base, previous, current);
  if (derived.hasAmbiguity) {
    return proposeConfirmableEntities(derived);
  }
  return derived;
}
```

Unambiguous entities land silently. Overlapping-but-compatible mentions produce one confirmable
entity proposal. Genuine contradictions are escalated to the author — never smoothed over, and
never written into the graph unreviewed.

## Markdown fidelity

Liminis round-trips a document through `parseMarkdown -> importMarkdownToLexical ->
exportLexicalToMdast -> stringifyMarkdown` on every open and save. That round trip must be stable:
a document nobody touched should not keep changing on disk. The table below summarizes the shapes
this reference document exercises.

| Construct | Example | Round-trips as |
| --- | --- | --- |
| Tight list | see Installation above | byte-identical |
| Loose list | see below | byte-identical |
| Blank line before list | see Support the ecosystem, above | exactly one blank line |
| Nested list | see Feature matrix, below | byte-identical |
| Multiple blank lines | see Formatting notes, below | collapsed to one |

### Loose list example

- First item, with its own paragraph of explanatory text that makes this list loose rather than
  tight.

- Second item, likewise given enough room to breathe that CommonMark classifies the whole list as
  loose rather than tight.

- Third item, closing out the loose list.

### Feature matrix

- Editing
  - WYSIWYG rich text, backed by Lexical
  - Markdown import/export via mdast
- Knowledge
  - Wiki links resolved against the live workspace
  - Graph visualization without entering edit mode
- Extraction
  - Automatic derivation of unambiguous entities
  - Confirmable proposals for compatible overlaps
  - Escalation for genuine contradictions

## Formatting notes

The blank-line rules below are intentionally exercised at their edges.

Three blank lines separate this paragraph from the one above — CommonMark treats any run of two
or more blank lines between blocks as equivalent to exactly one, so this collapses to a single
blank line on round trip. The same collapsing rule applies just before a list:

- This list follows three blank lines above
- and canonicalizes to exactly one blank line before it

## Frequently asked questions

**Does Liminis require a cloud account?**

No. Liminis only requires a local directory of markdown files. Syncing to a remote is optional and
entirely under the author's control.

**Can I use Liminis without the WYSIWYG editor?**

Yes — every document Liminis writes is plain, canonical markdown. You can edit it in any editor
and Liminis will pick up the changes the next time the file is opened.

**What happens to links if I edit files outside Liminis?**

The link resolver re-evaluates every wiki link against the new workspace the next time it's opened
in Liminis, using the `unchanged` / `re-attached` / `flagged` / `orphaned` classification described
above. Links are never silently rewritten.

## Architecture at a glance

Liminis's app is an Electron shell around a Lexical editor package and a Graphiti-backed knowledge
core:
```
liminis-app/src/main       Electron main process + IPC handlers
liminis-app/src/preload    window.api bridge exposed to the renderer
liminis-app/src/renderer   host shell (file browser, chat panel, workspace chrome)
packages/editor            the Lexical editor and its markdown mapper
liminis-app/src/shared     types and pure logic shared across processes
```

Two derived stores live outside the notebook directory and are never written back into it:

- the entity graph — extracted nodes and edges, held in FalkorDB
- the episode log — the extraction history each graph revision was derived from

Both are rebuildable from the markdown alone for anyone who wants to audit or regenerate them
outside the app, but neither store is ever written into the notebook, so neither one shows up in
`git status` or ordinary `git diff`.

## Keyboard shortcuts

Liminis keeps its shortcut surface small on purpose — most authoring actions are a single
keypress away, and none of them collide with the editor's own text-editing shortcuts.

| Action | Shortcut | Notes |
| --- | --- | --- |
| Insert wiki link | `Cmd+Shift+M` | Requires an active text selection |
| Follow link | `Enter` | While a link is focused in the editor |
| Toggle graph view | `Cmd+Shift+R` | Reversible — return with the same shortcut |
| Next unresolved link | `Tab` | Cycles only through orphaned links |
| Toggle chat panel | `Cmd+.` | Also collapses to icon-only mode |

None of these shortcuts are configurable yet; a future release may expose remapping through the
same settings surface that already controls editor font size and line spacing.

## Comparison with other tools

It's worth being explicit about what Liminis is not trying to replace:

- **Not a Google Docs replacement.** Liminis has no real-time co-editing cursor and does not aim
  to. Extraction happens on save, not keystroke-by-keystroke.
- **Not a PR review tool.** Notes in Liminis live as prose, not on a diff. A PR review tool
  like GitHub's own review UI is still the right place to review code changes.
- **Not a wiki.** Liminis has no concept of server-rendered page hierarchy or hosted publishing —
  it operates on a directory of markdown files, opened from local disk, at a time.

Where Liminis does compete directly is in the narrow niche of "a thinker needs durable, greppable
notes with a queryable graph over them, without handing their writing to someone else's database."

## Roadmap

Nothing below is committed to a release date; all of it is filed as a Fabrik issue when work
actually starts.

1. **Multi-notebook sessions** — open several related workspaces (a spec repo plus its linked
   research notes) in one session, with links cross-referencing between them.
2. **Suggested edits** — a lighter-weight alternative to full agent rewriting, closer to Google
   Docs' "suggesting" mode, for changes small enough not to need the full confirm-or-escalate
   flow.
3. **Export to a static snapshot** — a read-only HTML export of a notebook plus its graph
   neighborhood, for sharing with someone who doesn't have the app installed.
4. **Bulk link re-resolution** — a manual "re-check every link in this notebook" action, for
   recovering from an external tool making sweeping changes outside Liminis.

## Glossary

- **Wiki link** — the captured target title plus surrounding structural context that keeps a note
  attached to its content across workspace changes.
- **Episode** — the append-only extraction record a graph revision is derived from, held outside
  the notebook in a dedicated, never-checked-in store.
- **Extraction** — the process of deriving graph entities from a saved document, escalating
  only genuine contradictions to a human.
- **Canonical form** — the one consistent serialized output the markdown pipeline converges on
  after a single normalization pass; see [#943](https://github.com/verveguy/liminis/issues/943).

## Extended FAQ

**Why not just use raw markdown files with grep?**

Grep shows what a document says, not how it relates to everything else you have written. Liminis's
graph layer is additive: it never rewrites the markdown, it annotates the result.

**What happens if I open a document that was last saved by a different, older version of the
app?**

The parse/serialize round trip is deterministic given the current pipeline version, so an older
document is simply normalized to the current canonical form on its next save — the same one-time
diff any markdown formatter would produce, and never touched again afterward.

**Is the episode log rewritten in place, ever?**

No. Every record — an extraction, a revision, a confirmation, a rejection — is appended, never
edited or removed. Discarding one is itself represented as a record, not a mutation of history.

**Does hiding a note delete its content?**

No — hiding only changes the note's visibility. Every note hidden from the browser is still
present on disk; unhiding simply flips the state back.

## Contributing

Contributions are welcome. A few conventions to follow:

1. Feature work goes through a Fabrik-driven issue, not a hand-authored spec
2. Smaller fixes go through a git worktree and a pull request — never a direct commit to `main`
3. Architecture decisions get recorded in `docs/project_notes/decisions/`, not buried in a PR

### Reporting a bug

When filing a bug report, include:

- The exact markdown that reproduces the issue, if the bug is in the editor or serializer
- Whether the issue reproduces with a fresh document or only an existing one
- Any relevant ADR entries that might already cover the tradeoff in question

### Filing a feature request

Feature requests follow the same Fabrik-driven flow as bug reports, but with a different bar for
acceptance:

- The request should describe the problem, not a specific implementation
- It should explain who is affected and how often the problem comes up
- It should note whether an existing `ideas/` sketch already covers the same ground

Requests that skip straight to "add a button that does X" without explaining the underlying
problem are usually sent back for more detail before they're filed as an issue at all — a Spec
Kit spec needs the "why" to produce a testable "what."

## Support

There is no dedicated support channel yet. For now:

- Bugs and feature requests go through GitHub issues on this repository
- Questions about the underlying graph model are usually answered by reading the ADR index first
- Anything security-related should be reported privately rather than as a public issue

## Acknowledgments

Liminis's editor core is packaged as `@liminis/editor`, an extractable markdown/WYSIWYG editor,
rather than left grafted into the app. The extraction is scoped intentionally — see ADR-075 for
the provenance and the boundary of what was carried over versus rewritten. The graph plumbing
underneath both the entity store and the extraction pipeline builds on Graphiti, chosen for its
episode-based temporal model rather than a lower-level bindings library, again to keep the core
approachable for contributors who are comfortable with a graph's query surface but not
necessarily with its internals.

## License

This project is provided as-is for internal evaluation. See the repository's root `LICENSE` file
for the full terms.

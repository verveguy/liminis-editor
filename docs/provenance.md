# Provenance

Where this repository came from, and how to read the references in it.

## The extraction

`@liminis/editor` began as a directory inside the Liminis monorepo,
`verveguy/liminis`. It was extracted into this repository by
verveguy/liminis#995 on 2026-08-15.

The extraction used `git filter-repo` against a throwaway clone of
`verveguy/liminis` at commit `34f0d828`, scoped to the paths that made up the
package and its examples:

```
packages/editor            → (repository root)
examples/demo              → examples/demo
examples/external-consumer → examples/external-consumer
scripts/verify-package.mjs → scripts/verify-package.mjs
scripts/run-demo.mjs       → scripts/run-demo.mjs
```

The result is **real history, not a squashed import**: 140 commits on `main`,
including the sequence of adoption defects that a second consumer found in the
package during August 2026 (verveguy/liminis#951 through #954, #961 and #965).
`git log` on any file under `src/` shows the commit that introduced it.

The source repository was not rewritten. The clone was thrown away.

### What did not come across

- The package's CI jobs, which lived in the monorepo's `.github/workflows/test.yml`.
  They are replaced by this repository's own `.github/workflows/ci.yml`.
- The monorepo's `pnpm-workspace.yaml`. This repository has **no workspace file**,
  which is what makes `examples/*` external consumers by construction rather than
  by convention. See the note in `scripts/verify-package.mjs`.
- History from before the package was a package. The editor previously lived at
  `liminis-app/src/editor` and has roughly 287 commits of prior history there.
  Those commits are interleaved with changes to an application this repository is
  not about, so they were deliberately left behind. They remain in
  `verveguy/liminis`.

## Reading the references

### `ADR-0NNN`

Resolves to `docs/decisions/adr-0NNN.md`. See that directory's `README.md`,
which also explains the handful of numbers cited *inside* those documents that
belong to the host application rather than to this package.

Where the package's own code cited an application decision — the Claude Agent SDK
integration, MCP stdio concurrency, the knowledge corrections pipeline, the ban on
native browser dialogs — the citation was removed at extraction and the reasoning
written out at the call site instead, so it stands on its own.

### `FR-NNN`, `SC-NNN`, `NFR-NNN`

These are requirement and success-criterion identifiers from Spec Kit
specifications, and they are **scoped to the issue whose work introduced them**.
An `FR-004` in one comment and an `FR-004` in another are unrelated unless the
comments are about the same issue.

They resolve under `specs/` in `verveguy/liminis`, in the directory named for the
issue number, e.g. `specs/995-extract-liminis-editor-into/spec.md`.

They were left as-is rather than rewritten. There are several hundred across the
package's source, concentrated in its most heavily commented code, and rewriting
them all would have made `git log -p` unreadable for exactly the history this
extraction went to some trouble to preserve. Where a comment was edited for other
reasons during the extraction, its identifiers were made self-describing.

### `#NNN`

A bare `#NNN` in a source comment refers to an issue in **`verveguy/liminis`**,
because that is where the package's backlog lived when the comment was written.
Read `#973` as `verveguy/liminis#973`.

References written *since* the extraction are fully qualified. Where you see
`verveguy/liminis#995`, that qualification is deliberate and load-bearing: issue
numbers in this repository are their own sequence, and this repository already has
issues #1, #2 and #3 that have nothing to do with the ones the comments mean.

## Vendored documents

`src/app/mapper/__tests__/fixtures/real-documents/` holds byte-identical copies of
real ADRs from `verveguy/liminis`, used as realistic round-trip input. Its own
`README.md` records their provenance. They are vendored rather than read from a
sibling checkout precisely so that no test in this repository reads a file outside
it.

`src/app/mapper/__tests__/fixtures/roundtrip/50-reference-readme.md` and its
`.expected.md` pair contain strings that look like citations — `ADR-` prefixes, a
`docs/project_notes/` path. They are neither citations nor mistakes: they are
deliberately messy human prose being used as round-trip corpus. They were left
untouched by the extraction's citation sweep, because editing them would change
the bytes the fixture asserts on.

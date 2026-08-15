# Vendored real documents

Real, human-written Markdown vendored into the package as test fixtures. Used by
`issue-973-adr-idempotence.test.ts` to assert the round-trip fixed point (#973, FR-007)
against realistic content rather than minimal synthetic cases.

## Provenance

| | |
|---|---|
| Source | `docs/project_notes/decisions/` in `verveguy/liminis` |
| Taken at commit | `c8ade44e0b0addc35c06acb197baf0a709a32ae4` (2026-08-13) |
| Selection | every ADR matching the interior-mixed pattern `` /\*\*[^*\n]*`[^`\n]+`[^*\n]*\*\*/ `` — 32 of them |
| Modifications | **none** — byte-identical copies |

The files are copied verbatim, with no added header, so the bytes under test are exactly
the bytes a user would have on disk. Provenance lives here rather than inside the
documents for that reason.

## Why these are vendored rather than read live

The first version of this test read `docs/project_notes/decisions/` directly, walking six
directories up and out of the package. That was the only test under `packages/editor/`
reading anything outside the package, and it would have broken when #949 extracts this
package into `verveguy/liminis-editor`: either the suite fails on day one in the new repo,
or someone makes the missing directory skip and the test becomes permanently vacuous —
exactly the rot the anti-vacuity guards exist to prevent.

Vendoring keeps the whole value of FR-007 (messy, realistic, human-written content:
tables, definition lists, nested lists, raw HTML) while letting the test travel with the
package. The trade is that these are a *snapshot* — see below.

## Not a general-purpose corpus

This directory is a **sibling** of `roundtrip/`, deliberately. The five auto-discovering
corpus suites (`fixture-roundtrip`, `mark-transparency-corpus`, `annotated-serialize-corpus`,
`list-item-block-content`, `mixed-checkbox-list`) all scan `fixtures/roundtrip` specifically.
Putting 260 KB of ADRs there would drag them into every one of those runs. Do not move
these into `roundtrip/`.

## Refreshing

These are a snapshot and will drift from the live ADRs; that is fine, because the
requirement is *realistic* content, not *current* content. There is no obligation to keep
them in sync. If you do refresh them, copy verbatim, update the commit above, and re-run
the suite — a document that stops matching the interior-mixed pattern will be caught by
the per-document guard rather than silently reducing coverage.

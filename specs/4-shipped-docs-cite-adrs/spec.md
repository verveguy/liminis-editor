# Feature Specification: Guard Against Dangling ADR Citations in Shipped Docs

**Feature Branch**: `fabrik/issue-4`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "`docs/` ships inside the published tarball (`files: [\"dist\", \"README.md\", \"LICENSE\", \"docs\"]`), and several of those documents cite ADRs that do not exist here. Present in `docs/decisions/`: ADR-075, 076, 077, 078, 079. Cited by `docs/*.md` but absent: ADR-002, 007, 008, 010, 012, 024, 025, 027, 034, 042, 057, 070, 080. The affected files are `annotations.md`, `editor-api.md`, `markdown-pipeline.md`, `provenance.md` and `zusammen-editor-capability-map.md`. Harmless while this repository is private. It stops being harmless the moment it is public: an adopter reading `docs/annotations.md` follows a citation to a decision record that does not exist and cannot be found, because it lives in a private repository they will never see. This is a prerequisite for making this repository public."

## Background

`docs/` ships inside the published npm tarball (`package.json`'s `files` field lists `dist`, `README.md`, `LICENSE`, `docs`). At the time this issue was filed, several shipped documents (`annotations.md`, `editor-api.md`, `markdown-pipeline.md`, `provenance.md`, `zusammen-editor-capability-map.md`) cited ADR numbers that don't exist anywhere in this repository — only ADR-075 through ADR-079 are present in `docs/decisions/`, but those files cited ADR-002, 007, 008, 010, 012, 024, 025, 027, 034, 042, 057, 070 and 080 as well. Those are mostly Liminis **application** decisions (IPC, Electron, the knowledge graph), not decisions about this editor package.

This is harmless while the repository is private. It stops being harmless the moment it is public: an adopter reading `docs/annotations.md` follows a citation to a decision record that does not exist and cannot be found, because it lived in a private repository they will never see. Closing this gap is a stated prerequisite for making the repository public.

**Content cleanup already landed.** Since this issue was filed, two commits already on this branch's history (`4f7101f` — "docs: bring the editor's decision records and requirements history across (#5)", and `d836f52` — "fix: point two comments at references that exist in this repository") brought a larger set of ADRs into `docs/decisions/` (it now holds ADR-002, 007, 010, 024, 024b, 025, 027, 057, 070 and 075–080) and corrected the affected prose. A full scan of the current repository confirms the citation-level problem described above is already resolved:

- `README.md` and every file directly under `docs/` (`annotations.md`, `editor-api.md`, `markdown-pipeline.md`, `provenance.md`, `zusammen-editor-capability-map.md`) now cite only ADR-075 and ADR-077, both of which exist in `docs/decisions/`.
- `docs/decisions/README.md` itself documents, by design, a further set of host-application ADR numbers (003, 008, 012, 032, 034, 042, 055) that are cited *inside* `docs/decisions/*.md` bodies and deliberately not imported — that directory is explicitly excluded from the "no dangling citation" guarantee, both by the issue's acceptance criteria and by that file's own explanation.
- ADR-080 specifically (called out in the original issue for a closer look) is not cited anywhere outside `docs/decisions/`, so no inline/move/drop decision remains outstanding for it.

What has **not** landed is the second half of the issue's request: a repeatable, automated check that fails if a dangling citation is ever reintroduced. That is the remaining, concrete scope of this spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Catch a reintroduced dangling ADR citation before it ships (Priority: P1)

As a maintainer preparing to make this repository public (or maintaining it afterward), I want an automated, repeatable check that fails whenever a shipped document cites an ADR number that has no corresponding record in `docs/decisions/`, so that the guarantee "no shipped citation points nowhere" holds permanently rather than as a one-time cleanup that can quietly regress on the next doc edit.

**Why this priority**: This is the acceptance criterion explicitly called out in the issue as necessary because it's "cheap to write, and this will otherwise regress." Without it, the cleanup already performed has no durability.

**Independent Test**: Temporarily add a line citing a made-up ADR number (e.g. `ADR-0999`, chosen so it cannot collide with a real record) to any shipped doc outside `docs/decisions/`. Run the check and confirm it fails, naming the offending file and ADR number. Remove the line and confirm the check passes again.

**Acceptance Scenarios**:

1. **Given** the repository in its current state, **When** the check runs, **Then** it passes — no shipped document cites an ADR number absent from `docs/decisions/`.
2. **Given** a shipped document (README.md or a file under `docs/` outside `docs/decisions/`) is edited to cite an ADR number for which no `docs/decisions/adr-0NN.md` exists, **When** the check runs, **Then** it fails and its output identifies both the citing file and the missing ADR number.
3. **Given** `docs/decisions/README.md` or any file inside `docs/decisions/` cites a host-application ADR number that is deliberately not present in this repository (e.g. ADR-003, ADR-008), **When** the check runs, **Then** those citations are not flagged, because `docs/decisions/` itself is excluded from the check by design.
4. **Given** the vendored round-trip test fixtures under `src/app/mapper/__tests__/fixtures/` contain ADR-like strings used as realistic test corpus, **When** the check runs, **Then** those strings are not flagged, because fixture content is not shipped documentation and must stay byte-identical.

---

### Edge Cases

- A citation uses a format the check doesn't expect (e.g. a suffixed variant like `ADR-024b`, or a number with different digit padding). The check should be judged against the citation style actually in use in this repository today (`ADR-0NN`, three digits, e.g. `ADR-002`, `ADR-075`) rather than needing to anticipate hypothetical formats.
- A new file is added directly under `docs/` in the future (not one of today's five) — the check must cover it without needing to be told about each file by name, i.e. it should scan the directory rather than a hardcoded file list.
- A citation inside `docs/decisions/*.md` referring to another record *within* `docs/decisions/` (e.g. ADR-078 citing ADR-075) — these are legitimate same-directory cross-references and are already unaffected either way, since `docs/decisions/` is excluded from the check.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A repeatable, automated check MUST scan `README.md` and every file under `docs/**`, excluding `docs/decisions/` itself, for citations matching the repository's ADR citation style (`ADR-0NN`).
- **FR-002**: For each citation found, the check MUST verify that a corresponding record exists at `docs/decisions/adr-0NN.md` (case-insensitive on the citation, matching the existing lowercase file-naming convention).
- **FR-003**: The check MUST fail with a non-zero exit status (or equivalent failing test result) when any citation resolves to a missing record, and its output MUST identify the citing file and the missing ADR number so the failure is actionable without further digging.
- **FR-004**: The check MUST pass when run against the repository's current state, since no dangling citation exists today.
- **FR-005**: The check MUST NOT flag citations found inside `docs/decisions/**` — that directory's own `README.md` already documents, by design, host-application ADR numbers that are cited there but intentionally not imported.
- **FR-006**: The check MUST NOT flag ADR-like strings found in vendored test fixture content (`src/app/mapper/__tests__/fixtures/**`), since that content is test corpus outside the published package and must remain byte-identical to its source.
- **FR-007**: The check MUST be runnable on demand (e.g. as part of the project's existing test/lint/CI flow) so that a pull request introducing a dangling citation can be caught before it merges, not just when someone remembers to look.

### Key Entities

- **ADR citation**: An occurrence of the pattern `ADR-0NN` in prose within a shipped document, referring to an architectural decision record by number.
- **ADR record**: A file at `docs/decisions/adr-0NN.md` that a citation is expected to resolve to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the check against the repository's current `main`/working state completes successfully with zero flagged citations.
- **SC-002**: Editing any shipped document to introduce a citation to a non-existent ADR number causes the check to fail, and the failure is visible before the change can merge (e.g. as part of CI or an equivalent required gate).
- **SC-003**: No manual, one-off audit (grep-and-eyeball) is required to catch a reintroduced dangling citation going forward — the check alone is sufficient.

## Assumptions

- "Shipped docs" is defined as `README.md` plus everything under `docs/**`, matching `package.json`'s `files` field, minus `docs/decisions/` itself (which documents its own, deliberate exceptions) — consistent with the issue's acceptance criteria.
- The content-level cleanup requested by the original issue (inline, move, or drop each dangling citation) is already complete, per the repository scan described in Background. This spec's remaining scope is the regression check itself, not further prose edits.
- The exact implementation mechanism for the check (a standalone script, a test file, a lint rule, etc.) and precisely where it plugs into the existing `lint`/`test`/CI flow are implementation decisions left to the Research/Plan stage.

## Out of Scope

- Reconciling the two copies of ADR-075/076/077/078/079 (this repository's `docs/decisions/` vs. `verveguy/liminis`'s originals) — `docs/decisions/README.md` already documents this as a deliberately deferred, separate pass.
- Importing the host-application ADRs (003, 008, 012, 032, 034, 042, 055) into this repository.
- Citations inside `specs/**/*.md` (historical Spec Kit specifications carried over from the extraction) — not part of the published package.
- Any change to the vendored fixture content under `src/app/mapper/__tests__/fixtures/**` — it must remain byte-identical to its source.

## Source References

- `docs/decisions/README.md` — documents the host-application ADR numbers that are deliberately cited but absent, and why.
- `docs/provenance.md` — explains how `ADR-0NNN` references should be read in this extracted repository.
- `package.json` (`files` field) — defines what actually ships in the published package.
- Prior commits `4f7101f` and `d836f52` — the cleanup that already resolved the content-level portion of this issue.

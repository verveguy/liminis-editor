# Feature Specification: Publish a release containing the DocumentOutline markdown-derivation fix (#84/PR #85)

**Feature Branch**: `fabrik/issue-88`
**Created**: 2026-08-19
**Status**: Specified
**Input**: User description: "The latest published npm version is 0.2.1, published before PR #85 (#84's DocumentOutline markdown-derivation fix) merged to main. Bump package.json's version, cut a GitHub Release so publish.yml fires and publishes to npm, then verify the published package actually contains PR #85's API surface and that peerDependencies are unchanged."

## Background

[verveguy/liminis#1022](https://github.com/verveguy/liminis/issues/1022) (in the
`liminis` app repo) needs to adopt `DocumentOutline`/`createDocumentOutlineHandle` in
place of that app's own `TableOfContents.tsx`. The blocker — issue #84 here — was
fixed and merged via PR #85, adding `DocumentOutlineHandle.publishFromMarkdown(markdown)`
and `.setActiveLine(line)`, a standalone `deriveOutlineFromMarkdown`/
`resolveActiveOutlineIndex` pair, and an optional `line` field on `OutlineEntry`. This
work is already recorded, unreleased, at the top of `CHANGELOG.md`.

The latest published npm version is `0.2.1`, published *before* PR #85 merged.
`main`'s `package.json` still reads `"version": "0.2.1"`. `publish.yml` triggers only
on `release: published` (a manual GitHub Release) — never automatically on merge to
`main` — so the fix exists on `main` but nothing has published it. `liminis-app`'s
issue #1022 is blocked on this release existing: its Implement stage cannot bump
`liminis-app/package.json`'s `@liminis/editor` dependency to a version that doesn't
exist yet. This issue is the release-coordination step; #1022 resumes once this
closes.

This project follows a documented `0.x` versioning policy (`README.md`, "Versioning
policy"): **minor versions may break; patch versions may not.** PR #85 is additive and
backward compatible — new optional API surface, nothing removed or changed in meaning
— so it is a patch release, matching the precedent set by the `0.2.0` → `0.2.1`
release (commit `6f1fd2a`), which shipped a similarly additive, backward-compatible
change (App prop forwarding for #80) as a patch rather than a minor bump specifically
to avoid forcing consumers to raise their `^0.2.0`-style dependency ranges for a change
that takes nothing away from them. The next free patch version is `0.2.2`; it has not
been published to npm or tagged in this repository.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - liminis-app can depend on a published fix (Priority: P1)

As the person resuming `liminis-app`'s issue #1022, I want a real, installable
`@liminis/editor` npm release that contains PR #85's markdown-derived outline support,
so I can bump `liminis-app/package.json`'s dependency to a version that actually
exports `publishFromMarkdown`/`setActiveLine`/`OutlineEntry.line`, instead of pointing
at a version tag that predates the fix.

**Why this priority**: This is the entire reason the issue exists — #1022 is blocked
until this release is real and verified, not merely tagged.

**Independent Test**: After the release is cut, run `npm view @liminis/editor version`
and confirm it reports the new version; download or install the published tarball and
confirm `dist/index.d.ts` declares `publishFromMarkdown`, `setActiveLine`, and
`OutlineEntry.line`.

**Acceptance Scenarios**:

1. **Given** `main` contains PR #85 merged and `package.json` still reads `0.2.1`,
   **When** the version is bumped to the next patch version and a GitHub Release is
   cut at that version's tag, **Then** `publish.yml` runs to completion and publishes
   `@liminis/editor` at that version to the npm registry under the `latest` dist-tag.
2. **Given** the new version has been published, **When** its `dist/index.d.ts` is
   inspected (via a fresh install or tarball extraction), **Then** it declares
   `DocumentOutlineHandle.publishFromMarkdown`, `DocumentOutlineHandle.setActiveLine`,
   and an optional `line` field on `OutlineEntry` — confirming the published build was
   made from a commit that includes PR #85, not an earlier one.
3. **Given** the new version has been published, **When** its `package.json`'s
   `peerDependencies` are compared against `0.2.1`'s, **Then** they are identical
   (`lexical`/`@lexical/*` `^0.44.0`, `react`/`react-dom` `^19.2.0`), so `liminis-app`
   needs no peer-version follow-up alongside the dependency bump.

---

### Edge Cases

- **`publish.yml` fails after the tag already exists** (e.g. a transient CI failure in
  typecheck/lint/test/`verify:package`, or the tag-vs-`package.json` check): the
  release and its tag exist on GitHub but nothing was published to npm — a stranded
  release. Recovery is re-running or re-triggering the same published release (the
  workflow is not automatically retried), not cutting a second tag for the same
  version.
- **The published tarball is version-bumped but not rebuilt from the right commit**:
  the release notes/tag could in principle be cut from a commit prior to PR #85's
  merge (e.g. a stale local branch). This is why verification inspects the actual
  shipped `dist/index.d.ts` rather than trusting the version number alone.
- **`CHANGELOG.md`'s `## Unreleased` heading is left unretitled**: if the changelog
  entry documenting PR #85 is not moved under a dated version heading before or as
  part of the release, the changelog and `package.json` fall out of sync the same way
  they did before commit `6f1fd2a` (which fixed an analogous drift between a `0.3.0`
  changelog heading and a `0.2.0` `package.json`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `package.json`'s `version` MUST be bumped from `0.2.1` to `0.2.2` (the
  next patch version), consistent with this project's `0.x` versioning policy and the
  precedent set by the `0.2.1` release for a similarly additive, backward-compatible
  change.
- **FR-002**: `CHANGELOG.md`'s `## Unreleased` heading (currently documenting PR #85
  under `### Added`) MUST be retitled to a dated `## 0.2.2 — <release date>` heading as
  part of cutting the release, so the changelog and `package.json` version stay in
  sync and the existing entry becomes the release's notes source, matching the pattern
  established in commit `6f1fd2a`.
- **FR-003**: A GitHub Release MUST be cut at tag `v0.2.2` (matching this repository's
  `v<version>` tag convention), with release notes covering PR #85's `DocumentOutline`
  markdown-derivation fix — `publishFromMarkdown`, `setActiveLine`,
  `deriveOutlineFromMarkdown`, `resolveActiveOutlineIndex`, `OutlineEntry.line`, and
  `onEntrySelect`.
- **FR-004**: Publishing that release MUST trigger `.github/workflows/publish.yml`
  (its `release: published` event), which MUST complete successfully — typecheck,
  lint, test, `verify:package`, the tag-vs-`package.json` match check, and
  `npm publish --provenance --access public --tag latest` — resulting in
  `@liminis/editor@0.2.2` being published to the npm registry.
- **FR-005**: After publish, `npm view @liminis/editor version` MUST report `0.2.2`.
- **FR-006**: After publish, the published package's `dist/index.d.ts` MUST be
  inspected (via tarball download/extraction or a fresh install) and confirmed to
  declare `DocumentOutlineHandle.publishFromMarkdown`, `DocumentOutlineHandle.setActiveLine`,
  and `OutlineEntry.line`, as a positive check that the published build was made from a
  commit including PR #85 — a version bump alone is not sufficient evidence.
- **FR-007**: The published `0.2.2` package's `peerDependencies` MUST be verified
  unchanged from `0.2.1`'s: `@lexical/*` and `lexical` at `^0.44.0`, `react` and
  `react-dom` at `^19.2.0`.

### Key Entities

- **GitHub Release**: the tagged (`v0.2.2`), published release object whose
  `release: published` event is `publish.yml`'s sole trigger; its notes are the
  human-facing record of what shipped.
- **npm package version**: the `@liminis/editor@0.2.2` artifact published to the npm
  registry, distinct from the git tag — FR-006 exists because the tag/release being
  cut correctly does not by itself guarantee the published tarball's contents match.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm view @liminis/editor version` returns `0.2.2`.
- **SC-002**: The published `0.2.2` tarball's `dist/index.d.ts` contains
  `publishFromMarkdown`, `setActiveLine`, and `OutlineEntry`'s `line` field.
- **SC-003**: The published `0.2.2` package's `peerDependencies` are byte-for-byte
  identical to `0.2.1`'s.
- **SC-004**: `liminis-app`'s issue #1022 Implement stage can add
  `"@liminis/editor": "^0.2.2"` (or an equivalent compatible range) to its
  `package.json` and resolve it via a real install, with no peer-dependency follow-up
  required.

## Assumptions

- The release is cut by whoever executes this issue's Implement stage (or another
  authorized human/agent with repository release permissions), since `publish.yml`
  only fires on a real `release: published` event — there is no automation in this
  repository that cuts a release unattended.
- PR #85 is already merged to `main` (confirmed: merge commit `ea60322`), and no
  further code changes are needed on `main` before cutting the release — this issue is
  release coordination only, not additional development.
- npm trusted publishing (OIDC) is already configured for this repository and
  workflow, as `publish.yml` assumes; this issue exercises that existing
  infrastructure and does not set it up.
- Cutting the release is a real, externally visible action (a public npm publish under
  the `latest` dist-tag) — not a reversible local operation.

## Out of Scope

- Any change to `liminis-app` or its issue #1022 — this issue only makes the release
  those changes will depend on exist and be verified.
- Any new feature or fix beyond what PR #85 already merged.
- Any change to `peerDependencies` or other `package.json` fields besides `version`
  (FR-007 requires verifying they are unchanged, not changing them).
- Modifying `publish.yml`, trusted-publishing configuration, or npm provenance
  settings.
- Publishing under a prerelease/`next` dist-tag — `0.2.2` is a normal (non-prerelease)
  version, so `publish.yml`'s dist-tag logic resolves to `latest`.

## Source References

- PR #85 and issue #84 (this repository) — the merged fix this release publishes.
- `CHANGELOG.md`'s `## Unreleased` section — already documents PR #85's changes.
- `.github/workflows/publish.yml` — the publish trigger and its checks (tag/version
  match, trusted publishing, dist-tag selection).
- `README.md`, "Versioning policy" section — the `0.x` minor-may-break/patch-may-not
  policy this release follows.
- Commit `6f1fd2a` ("release: 0.2.1 — App forwards documentOutlineHandle") — the direct
  precedent for cutting a patch release for an additive, backward-compatible change,
  including the `CHANGELOG.md`/`package.json` sync requirement (FR-002).
- verveguy/liminis#1022 (external repo) — the consumer blocked on this release.

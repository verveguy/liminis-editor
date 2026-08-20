# Feature Specification: Lexical peer range pins hosts to 0.44.x — no published version admits 0.49

**Feature Branch**: `fabrik/issue-92`
**Created**: 2026-08-20
**Status**: Draft
**Input**: User description: "Every published version of `@liminis/editor` — including the current `0.2.1` — declares its Lexical peer range as `^0.44.0`. Lexical is now at 0.49.0. Because Lexical is a `0.x` package, `^0.44.0` resolves to `>=0.44.0 <0.45.0` under semver — so this range excludes every release from 0.45 onward, not just breaking ones. The practical effect is that `@liminis/editor` pins its host application to a Lexical line that is five minors behind, and there is no published version of this package a host can upgrade to in order to move forward."

## Background

Every published version of `@liminis/editor` — including the current `0.2.1` — declares its Lexical peer range as `^0.44.0` across twelve packages (`lexical` and eleven `@lexical/*` scoped packages). Lexical itself has moved on to `0.49.0`. Because Lexical is a `0.x` package, `^0.44.0` resolves under semver to `>=0.44.0 <0.45.0` — it admits patch releases of 0.44 only, and excludes every 0.45+ release regardless of whether that release was actually breaking. The practical effect: `@liminis/editor` pins every host application to a Lexical line that is five minors behind, and no published version of this package gives a host a path forward.

This surfaced while refreshing `liminis-app`'s dependencies (verveguy/liminis#1026): the Lexical family was bumped 0.44.0 → 0.49.0 and tested in isolation. It passed typecheck, lint, build, and the full 3275-test suite — and was still wrong, because `liminis-app` would have been shipping in violation of this package's declared peer contract. The app's unit suite does not exercise the editor deeply enough to catch a Lexical behavioural regression, so a green suite there is not evidence of compatibility. The bump was reverted and held out of that PR pending this issue.

Beyond the immediate unblock, the issue exposes a structural problem: a `^` range on a `0.x` peer dependency is far narrower than it looks, and will reproduce this exact stall at every future Lexical minor unless a deliberate range policy is adopted. This mirrors two prior instances of consumer-facing surface needing explicit treatment: #78 (a required member made 0.2.0 type-level breaking) and #79 (token definitions are public API, documented accordingly).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Host can adopt current Lexical without violating the peer contract (Priority: P1)

A host application (e.g. `liminis-app`) wants to bump its Lexical family dependency to 0.49.0. Today, doing so leaves it running `@liminis/editor` in violation of the package's own declared peer range, even though nothing else prevents the bump.

**Why this priority**: This is the issue's entire motivation — it directly unblocks the Lexical portion of verveguy/liminis#1026 and is the only story that must ship for the issue to be resolved.

**Independent Test**: In a fresh consumer project depending on the newly published `@liminis/editor`, run `pnpm add lexical@0.49.0 @lexical/react@0.49.0 ...` (the full family) and confirm the install completes with no unmet-peer-dependency warning.

**Acceptance Scenarios**:

1. **Given** a host with Lexical 0.49.0 installed, **When** it installs the new `@liminis/editor` release, **Then** package manager peer resolution reports no unmet or conflicting Lexical peer warning.
2. **Given** the package's own test suite, **When** run against Lexical 0.49.0, **Then** it passes in full (no skipped or weakened assertions to force a pass).
3. **Given** the package's own build and typecheck, **When** run against Lexical 0.49.0, **Then** both succeed with no new errors.

---

### User Story 2 - Consumers can tell what Lexical versions are supported and why (Priority: P2)

A consumer reading the package's docs (or hitting a peer-range mismatch) needs to understand what Lexical version(s) `@liminis/editor` supports, and what to expect from the range at the next Lexical minor release — rather than rediscovering this issue's failure mode themselves.

**Why this priority**: Directly required by the issue ("Whatever is chosen should be written down in the package's docs, since these ranges are consumer-facing API"); without it, the same stall recurs undocumented at 0.50.

**Independent Test**: Read the README's install section and confirm it states the supported Lexical range accurately and explains the policy behind its shape.

**Acceptance Scenarios**:

1. **Given** the README's install instructions, **When** a consumer reads them, **Then** the documented `pnpm add` command and peer ranges match what `package.json` actually declares.
2. **Given** the package's docs, **When** a consumer wants to know what happens at the next Lexical minor, **Then** the documented policy tells them (e.g. whether the range will need bumping again, or already admits it).

---

### Edge Cases

- Lexical 0.49.0 may have removed, renamed, or changed the behavior of an API this package depends on (node types, hooks, internal utilities) at any point across the 0.45–0.49 minors; each minor is permitted to be breaking under Lexical's own `0.x` versioning and none should be assumed compatible without verification.
- A host with only some of the twelve Lexical packages upgraded to 0.49.0 and others still on 0.44.x (a partial/inconsistent upgrade) should still receive an accurate unmet-peer-dependency warning from its package manager, not a silent broken install.
- Whatever range shape is chosen (see Open Questions in the issue-tracking history of this spec), any version it admits that is not actually exercised by CI represents an unverified compatibility claim — this should be reflected honestly in the documented policy rather than implied to be tested.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The package's own Lexical dependencies — `lexical` and all eleven `@lexical/*` packages, in both `devDependencies` and `peerDependencies` — MUST be updated to 0.49.0.
- **FR-002**: The package's source code MUST be updated as needed to work correctly against Lexical 0.49.0, accounting for breaking changes that may exist at any point across the 0.45 → 0.49 minor releases.
- **FR-003**: The existing test suite MUST pass in full against Lexical 0.49.0, without skipping, deleting, or weakening tests solely to force a pass.
- **FR-004**: The twelve peer dependency ranges (`lexical` and the eleven `@lexical/*` packages) MUST be widened such that a host installing Lexical 0.49.0 across the family receives no unmet-peer-dependency warning from `@liminis/editor`.
- **FR-005**: The README's Lexical install instructions (the `pnpm add ... lexical@^0.44 ...` block) and the `package.json` `//peerDependencies` manifest comment MUST be updated to reflect the new ranges and to stay accurate about what CI actually tests versus what the range admits.
- **FR-006**: The peer-range policy adopted for `0.x` Lexical dependencies MUST be documented in the package's consumer-facing docs, stating what versions are supported, why the range takes the shape it does, and what a consumer should expect at the next Lexical minor.
- **FR-007**: The CHANGELOG MUST gain an entry (under `## Unreleased`, per the repo's existing convention) describing the Lexical bump, any consumer-visible behavioral changes, and the peer-range change, so a maintainer can cut a release from it.
- **FR-008**: This change MUST NOT alter the `react` / `react-dom` peer ranges or any dependency outside the Lexical family.

### Key Entities

- **Lexical family**: The twelve packages (`lexical` plus eleven `@lexical/*` scoped packages) that this package depends on and re-declares as peers. They move in lockstep — this issue treats them as a single unit, never bumping a subset.
- **Peer dependency range**: The version range declared in `peerDependencies` for each Lexical family member; this is the package's consumer-facing compatibility contract, not necessarily equal to what CI tests.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` all pass with Lexical 0.49.0 installed.
- **SC-002**: Installing the full Lexical family at 0.49.0 alongside the new `@liminis/editor` release in a fresh consumer project produces zero unmet-peer-dependency warnings.
- **SC-003**: `liminis-app` (verveguy/liminis#1026) can bump its Lexical family to 0.49.0 with no unmet peer warnings against the new `@liminis/editor` release.
- **SC-004**: The README and CHANGELOG document the supported Lexical version(s) and the peer-range policy clearly enough that a consumer does not need to read this issue to understand them.

## Assumptions

- Cutting the actual release — bumping `package.json`'s `version`, retitling the CHANGELOG's `Unreleased` heading, creating the GitHub Release that triggers `.github/workflows/publish.yml`'s npm publish — is a separate manual maintainer step performed directly on `main` after this work merges, consistent with existing repo precedent (e.g. commits `6f1fd2a` "release: 0.2.1" and `45e040e` "release: 0.2.2", neither of which was part of the feature PR they released). This issue's scope ends at a merged PR with an `Unreleased` CHANGELOG entry ready to release from — it does not include creating the GitHub Release or triggering the publish workflow.
- Per the project's established 0.x versioning policy (README: "Minor versions may contain breaking changes; patch versions will not."), this change — which alters the peer contract and depends on Lexical behavior across five minors — warrants a minor version bump at release time. The exact version number is decided by the maintainer when the release is cut, not by this issue.
- Only the Lexical family is in scope. `react` / `react-dom` peer ranges and all other dependencies are untouched.
- CI currently resolves and tests exactly one point version per peer range (the latest available). This issue is not required to introduce multi-version CI matrix testing unless the peer-range policy decided for this change depends on that testing to be an honest claim.

## Out of Scope

- Publishing the release / triggering the npm publish workflow (see Assumptions).
- Changes to `react` / `react-dom` peer ranges or any dependency outside the Lexical family.
- New editor features or behavior changes unrelated to Lexical 0.45–0.49 compatibility.
- Introducing multi-version CI matrix testing infrastructure, unless required to support the chosen peer-range policy.

## Source References

- `package.json` — `peerDependencies`, `devDependencies`, and the `//peerDependencies` manifest comment
- `README.md` — Install section (Lexical `pnpm add` instructions, `0.x` versioning policy note)
- `CHANGELOG.md` — existing `Unreleased` / release entry conventions
- `.github/workflows/publish.yml`, `.github/workflows/ci.yml` — release and CI mechanics
- `tests/package-manifest-contract.test.ts` — existing peer-floor enforcement pattern (react), a template for any equivalent Lexical enforcement
- `docs/decisions/adr-078.md`, `docs/decisions/adr-079.md` — prior ADRs on consumer-facing package surface
- Related: #78, #79 (consumer-facing surface needing explicit treatment); blocks verveguy/liminis#1026

# Feature Specification: `@liminis/editor`: GitHub Pages site — live demo plus adopter documentation

**Feature Branch**: `fabrik/issue-3`
**Created**: 2026-08-15
**Status**: Specified
**Input**: User description: "Once `@liminis/editor` is a public repository, it needs a public face: a GitHub Pages site that both demonstrates the editor live and documents it."

## Background

Today the package's documentation is a 9.7 KB `README.md` plus `docs/` shipped inside the tarball. That is adequate for someone who has already decided to adopt it. It does nothing for someone deciding *whether* to.

This is a WYSIWYG markdown editor. Its value proposition is not describable in prose — a reader either types in it and sees callouts, toggles, Mermaid, math and wiki-links behave, or they do not evaluate it at all. Screenshots would understate it and a README cannot show round-trip fidelity, which is the package's actual distinguishing claim: what you type is what lands on disk, byte for byte. A live demo, showing a visitor's edits and the resulting markdown side by side, is the only way to demonstrate that property directly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluate the editor live (Priority: P1)

A prospective adopter who is deciding whether to use `@liminis/editor` visits the Pages site, types in the live editor, and sees the resulting markdown update side by side, so they can judge WYSIWYG round-trip fidelity for themselves rather than trusting a README claim.

**Why this priority**: This is the primary value proposition of the issue — a live demo is the only way to prove the round-trip claim; without it the site is just another README.

**Independent Test**: Load the Pages URL, edit content that exercises callouts, toggles, Mermaid, math, and wiki-links, and confirm the markdown pane updates to match, byte for byte, what was typed.

**Acceptance Scenarios**:

1. **Given** the Pages site is loaded, **When** a visitor types or edits content in the live editor pane, **Then** the markdown output pane updates to reflect the exact markdown that would be written to disk.
2. **Given** the demo, **When** a visitor loads a sample document exercising callouts, toggles, Mermaid, math, or wiki-links, **Then** each construct renders and round-trips correctly.
3. **Given** `editorNodes` defines the supported construct set, **When** a visitor explores the demo, **Then** every construct in `editorNodes` is reachable and demonstrable from the site.

---

### User Story 2 - Learn the public API surface before installing (Priority: P2)

An adopter who has decided to evaluate the package needs documentation covering the seven subpath exports, peer dependencies, the `sideEffects` bundler pitfall, the versioning policy, and the annotation mechanism, so that they can integrate the package correctly on the first attempt.

**Why this priority**: Necessary content for adoption, but secondary to the live demo, which drives the initial decision to look further.

**Independent Test**: Read the documentation section of the site and confirm all six required documentation points are present and accurate against `package.json` and the relevant ADRs.

**Acceptance Scenarios**:

1. **Given** the documentation section, **When** an adopter reads it, **Then** all seven subpath exports (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`, `./nodes`, `./styles.css`) are listed with their purpose and Lexical-free status.
2. **Given** the documentation section, **When** an adopter reads it, **Then** all 14 peer dependencies and their expected versions are listed.
3. **Given** the documentation section, **When** an adopter reads it, **Then** the `sideEffects` landmine (ADR-075 §4) is explained, including the `ReferenceError: Prism is not defined` symptom and why the package itself cannot express the fix.
4. **Given** the documentation section, **When** an adopter reads it, **Then** the `0.x` versioning policy is stated.
5. **Given** the documentation section, **When** an adopter reads it, **Then** the annotation mechanism (ADR-077) is explained.

---

### User Story 3 - Know which version the demo represents (Priority: P2)

An evaluator viewing the site needs to know, without digging, whether they are looking at behaviour matching `0.1.0-rc.1`, `0.3.0`, or another published version, so they don't mistake in-progress branch behaviour for what `npm install` would give them.

**Why this priority**: Directly required by the pinning decision below; without a visible version indicator the pinning decision has no observable effect for the visitor.

**Independent Test**: Load the site and confirm a visible, unambiguous version string is shown that matches the published npm version the demo was built against.

**Acceptance Scenarios**:

1. **Given** the site is deployed against a published version, **When** a visitor loads the page, **Then** the exact version string (e.g. `0.1.0-rc.1`) is visible without further navigation.

---

### Edge Cases

- No release has been published yet: the site has nothing to deploy against, since deploys are release-triggered, not branch-triggered. (The first deploy is expected to be against `0.1.0-rc.1`.)
- A release is published that does not change the demo's underlying constructs: the deploy still runs and the version indicator updates, even though the demo content stays materially the same.
- Time passes between releases: the site is deliberately stale relative to the default branch — this is intended behaviour, not drift to be fixed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site MUST provide a live editor view where a visitor can type/edit content and see the resulting markdown output displayed side by side, updating as they edit.
- **FR-002**: Every construct supported by `editorNodes` MUST be demonstrable from the site (directly editable or loadable as a sample document).
- **FR-003**: Sample documents demonstrating supported constructs SHOULD be loadable from the shared fixtures used by verveguy/liminis-editor#2's web shell, so the demo and the fixtures do not drift.
- **FR-004**: The demo MUST be built from the same source as the feature web shell in verveguy/liminis-editor#2 — one shared artifact, not a duplicated implementation.
- **FR-005**: The site's documentation MUST list all seven declared subpath exports (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`, `./nodes`, `./styles.css`), what each is for, and which are Lexical-free.
- **FR-006**: The site's documentation MUST list the 14 peer dependencies and their expected versions.
- **FR-007**: The site's documentation MUST explain the `sideEffects` bundler landmine described in ADR-075 §4, including the failure symptom and why the package itself cannot express the fix.
- **FR-008**: The site's documentation MUST state the versioning policy: `0.x` where minor versions may break and patch versions may not, that the seven subpaths are the supported API, and that anything reachable by a deeper import path is private.
- **FR-009**: The site's documentation MUST explain the annotation mechanism from ADR-077 (comments and corrections as two configurations of one primitive).
- **FR-010**: The Pages deploy MUST be triggered by a GitHub release being published, not by every merge to the default branch.
- **FR-011**: The site MUST display, visibly and without further navigation, the published package version the demo currently represents.
- **FR-012**: The deploy MUST run via GitHub Actions building from `verveguy/liminis-editor`, producing a static Vite build with no server component.
- **FR-013**: Between releases, the deployed site MUST remain unchanged even as the default branch continues to move — staleness relative to the default branch is expected behaviour, not a defect.

### Key Entities *(if applicable)*

- **Demo shell**: The live editor + markdown-output view, shared with verveguy/liminis-editor#2's web shell.
- **Sample fixtures**: Shared documents used to demonstrate constructs (callouts, toggles, Mermaid, math, wiki-links, etc.), sourced from the existing round-trip fixture corpus.
- **Documentation page(s)**: The adopter-facing content covering exports, peer dependencies, the sideEffects landmine, versioning policy, and annotations.
- **Release**: A published GitHub/npm release of `@liminis/editor` that triggers a Pages deploy and that the site's version indicator reflects.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A prospective adopter can reach a stable URL and, within the live demo, edit content and see matching markdown output for every construct in `editorNodes`.
- **SC-002**: All six required documentation points (exports, peer dependencies, the sideEffects landmine, versioning policy, and annotations) are present and locatable on the site.
- **SC-003**: A new GitHub release of `@liminis/editor` results in an automatic Pages deploy with no manual step, and the site's visible version indicator matches that release.
- **SC-004**: The site's demo code and verveguy/liminis-editor#2's web shell code do not diverge, verified by the demo building from the same shared source rather than a copy.

## Assumptions

- The repository will be made public before this work ships to a live URL (tracked as a separate gated decision, per the Depends on section below).
- verveguy/liminis-editor#2 (the feature web shell) lands first or in parallel, since this demo is built from it rather than being implemented independently.
- `0.1.0-rc.1`, the prerelease agreed on verveguy/liminis#949, is an acceptable first published version to deploy the site against, since it proves the registry install path the site's pinning is meant to represent.

## Out of Scope

- Flipping the repository from private to public (tracked separately, gated).
- Building the feature web shell itself (tracked in verveguy/liminis-editor#2).

## Depends on

- **This repository must be public.** It is currently private; the flip is a separate gated decision.
- **verveguy/liminis-editor#2** — the feature web shell this is built from.

## Source References *(optional)*

- ADR-075 §4 — the `sideEffects` bundler landmine.
- ADR-077 — the annotation mechanism (comments and corrections as two configurations of one primitive).
- verveguy/liminis-editor#2 — the feature web shell this demo is built from.
- verveguy/liminis#949 — the `0.1.0-rc.1` prerelease this site is expected to publish against first.

# Feature Specification: Correct the `0.2.0` Record — `getMarkRects` Is Breaking for `AnnotationEditorHandle` Implementors

**Feature Branch**: `fabrik/issue-78`
**Created**: 2026-08-19
**Status**: Specified
**Input**: User description: "`0.2.0` added `getMarkRects` to `AnnotationEditorHandle` as a required member. The release notes list it under 'Added' alongside two changes explicitly marked breaking, which is accurate at runtime but wrong for TypeScript consumers — anything that constructs or mocks `AnnotationEditorHandle` fails to compile. Decide how to resolve this and correct the record."

## Background

`0.2.0` added `getMarkRects(annotationIds?)` to `AnnotationEditorHandle` (`src/annotations/types.ts:211-232`) as a **required** member:

```ts
getMarkRects: (annotationIds?: readonly string[]) => Map<string, DOMRect[]>
```

Both `CHANGELOG.md`'s `## 0.2.0` section and the GitHub Release notes for tag `v0.2.0` (verified via `gh release view v0.2.0`) list this under an "Added" heading, alongside — but distinct from — two changes each explicitly headed "Breaking." That is accurate for *behavior*: no existing call to a handle the package already supplies changes. It is wrong for *types*: any code that **implements, constructs, or mocks** `AnnotationEditorHandle` — a test double, an alternative host, a wrapper — stops compiling, because TypeScript requires every member of a required-member interface to be present. Upgrading `liminis-app` hit exactly this: two hand-built mocks in `useDocumentComments.test.ts` failed with `TS2741: Property 'getMarkRects' is missing`.

This matters beyond the one-line fix. An adopter who reads "Added" reasonably budgets no migration work, then hits a compile error — which erodes the value of this changelog ever marking anything as breaking. It also sits awkwardly next to the same release's theming-token rename (#51), which was built specifically so `0.2.0` would not silently break a host at runtime. `getMarkRects` does break a host — at compile time, which is a better failure mode than silent breakage, but it was never announced as one.

**Both `0.2.0` and `0.2.1` are already published** (`v0.2.0` and `v0.2.1` tags exist on `main`; `npm view @liminis/editor versions` lists both). `0.2.1` is unrelated to this issue (it forwards `documentOutlineHandle` through `<App>`, #80). Nothing can retroactively change the type shape that `0.2.0`/`0.2.1` consumers already installed — the only thing this issue can correct is the historical record describing that shape, in place, the same way `CHANGELOG.md`'s `0.2.0` entry was previously corrected for two false claims about consumer migration (commit `d6a3b8b`, "correct two false claims about consumer migration"). Note also that `CHANGELOG.md` is not published inside the npm package (`package.json`'s `files` list is `dist`, `README.md`, `LICENSE`, `docs`) — an adopter reads it on GitHub, alongside the separate GitHub Release notes body, which repeats the same "Added: `getMarkRects()`" framing and needs the same correction.

The package's own stated versioning policy (`README.md`): *"This is `0.x`. Minor versions may contain breaking changes; patch versions will not."* `0.2.0` is a minor bump, so a breaking change in it is not a policy violation — the defect here is specifically the mislabeling (an actually-breaking change filed under "Added" rather than "Breaking"), not the existence of a break in a minor version.

### Options considered (from the issue)

1. **Make `getMarkRects` optional** (`getMarkRects?:`). Preserves "additive" for future releases, at the cost of every real caller — including the package's own internal wiring, which always supplies this method — needing an unnecessary undefined-guard. Doesn't fix `0.2.0`/`0.2.1` as already shipped (their required-member shape can't be changed retroactively), and doesn't stop the same problem recurring the next time a capability is added.
2. **Keep it required; correct the record.** Amend `CHANGELOG.md`'s `0.2.0` entry and the `v0.2.0` GitHub Release notes to state plainly that this is breaking for implementors, and give the one-line fix. No code change, no version bump — the cheapest response that is still honest about `0.2.0` as shipped, and the only option that actually corrects the artifact that misled `liminis-app`'s upgrade.
3. **Split the handle** into a package-provided type and a narrower host-must-supply type, so a new capability computed by the package is never a required member implementors must add. Structurally the right fix for recurrence — ADR-089 already names Zusammen #126 as the next consumer wanting more positional capability on this same handle, so this will come up again — but it is a larger, separate change: a new export shape that itself needs its own migration story for `liminis-app` and Zusammen, not a same-day documentation fix.

### Resolution

**This issue does Option 2 only.** `AnnotationEditorHandle` keeps `getMarkRects` as a required member; `src/annotations/types.ts` does not change. `CHANGELOG.md`'s existing `## 0.2.0` section and the `v0.2.0` GitHub Release notes are corrected in place — not as a new changelog entry or release — to state that `getMarkRects` is breaking for anything that implements the interface, that it is not breaking for code that only calls methods on a handle the package supplies, and to give the one-line fix. This requires no version bump and touches no consumer repository, because the shape does not change: the issue's own acceptance criterion "if the shape changes, both in-house consumers are updated in the same release" is therefore not triggered.

**Option 3 is recommended as a separate follow-up issue**, not folded into this one: it is the fix that stops this recurring as more capability lands on `AnnotationEditorHandle` (Zusammen #126 already wants some), but it is a distinct, larger design change that deserves its own spec and its own consumer-migration plan, rather than riding along with a same-day corrections fix.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reader correctly anticipates the compile-time break before upgrading (Priority: P1)

Someone maintaining code that implements or mocks `AnnotationEditorHandle` (a test double, an alternative host, a wrapper) reads the `0.2.0` release notes or `CHANGELOG.md` before upgrading `@liminis/editor`. They correctly conclude that `getMarkRects` will require a one-line addition to their implementation, and are not surprised by a `TS2741` compile error.

**Why this priority**: This is the entire purpose of the issue — the notes misled exactly this reader once already (`liminis-app`).

**Independent Test**: Read `CHANGELOG.md`'s `0.2.0` section and the `v0.2.0` GitHub Release notes with no other context; confirm both make clear, without reading unrelated prose, that `getMarkRects` requires action from anyone implementing the interface.

**Acceptance Scenarios**:

1. **Given** `CHANGELOG.md`'s `0.2.0` section, **When** a reader scans section headers only (not full prose), **Then** `getMarkRects`'s impact on implementors is as visible as the section's other two breaking entries — not filed silently under "Added."
2. **Given** the corrected `getMarkRects` entry (in `CHANGELOG.md` and in the `v0.2.0` GitHub Release notes), **When** read, **Then** it states plainly who is affected (code implementing, constructing, or mocking `AnnotationEditorHandle`) and who is not (code that only calls methods on a handle the package itself supplies, e.g. via `annotationEditorHandleRef`).
3. **Given** the corrected entry, **When** read, **Then** it states the one-line fix (add a `getMarkRects` implementation to any hand-built object satisfying `AnnotationEditorHandle`).

---

### Edge Cases

- A reader only checks `CHANGELOG.md` and never looks at the GitHub Release notes, or vice versa — both artifacts must independently carry the correction; neither may be left stale while the other is fixed.
- A future reader diffs `0.2.0`'s changelog entry against git history and notices it was edited after the tag was cut — this is expected and has direct precedent (`d6a3b8b`); it does not need special callout beyond what that precedent already established.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `CHANGELOG.md`'s existing `## 0.2.0` section MUST identify `getMarkRects` on `AnnotationEditorHandle` as breaking for any code that implements, constructs, or type-checks against that interface — with visibility comparable to the section's other two breaking entries — rather than being listed only under "Added" with no impact signal.
- **FR-002**: The corrected `CHANGELOG.md` entry MUST state explicitly that this is a type-level break only: it does not change behavior for code that merely calls methods on a handle instance the package itself supplies.
- **FR-003**: The corrected `CHANGELOG.md` entry MUST state the one-line fix: add a `getMarkRects` implementation to any hand-built object satisfying `AnnotationEditorHandle`.
- **FR-004**: The `v0.2.0` GitHub Release notes MUST receive the same correction (FR-001–FR-003) as `CHANGELOG.md`, since it is a separate artifact carrying the same "Added: `getMarkRects()`" framing.
- **FR-005**: The correction MUST be made in place within the existing `0.2.0` entry/release — it MUST NOT be filed as a new `CHANGELOG.md` version section, and MUST NOT create a new GitHub Release or release tag. This follows the precedent already set for this same section (commit `d6a3b8b`).
- **FR-006**: This issue MUST NOT change `package.json`'s version.
- **FR-007**: This issue MUST NOT change `AnnotationEditorHandle`'s shape in `src/annotations/types.ts` — `getMarkRects` remains a required member.
- **FR-008**: Because FR-007 holds, this issue MUST NOT make or require any code change in `liminis-app` or Zusammen — the "if the shape changes, both in-house consumers are updated in the same release" acceptance criterion from the issue is not triggered, and this spec records why.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader scanning only `CHANGELOG.md`'s `0.2.0` section headers can tell `getMarkRects` carries breaking impact for implementors, without reading full prose.
- **SC-002**: Both `CHANGELOG.md`'s `0.2.0` entry and the `v0.2.0` GitHub Release notes state, in their own words, who is affected (implementors/mocks/wrappers) and who is not (ordinary callers), plus the one-line fix.
- **SC-003**: No version bump, no `src/annotations/types.ts` change, and no `liminis-app`/Zusammen code change result from this issue.
- **SC-004**: A reviewer of this issue's PR can confirm, from the corrected text alone, that the same information a `TS2741`-hitting adopter needed (what broke, why, and the fix) is now present in both consumer-facing artifacts.

## Assumptions

- `CHANGELOG.md` is not shipped inside the npm package (`package.json`'s `files` field lists `dist`, `README.md`, `LICENSE`, `docs`); the two artifacts an adopter actually reads for release impact are the repo's `CHANGELOG.md` (via GitHub) and the GitHub Release notes for the relevant tag — both are in scope, per FR-001 and FR-004.
- Editing an already-published `CHANGELOG.md` entry and GitHub Release body in place, without a version bump, is an established pattern in this repo (commit `d6a3b8b` corrected two other false claims in this same `0.2.0` entry after it was already tagged).
- Per `README.md`'s stated versioning policy, a breaking change in a `0.x` minor version is not itself a policy violation; the defect this issue fixes is the mislabeling, not the existence of the break.
- `docs/editor-api.md`'s existing `AnnotationEditorHandle` reference row (which lists `getMarkRects` among the handle's members) makes no additive/non-breaking claim and needs no correction.

## Out of Scope

- Changing `AnnotationEditorHandle`'s TypeScript shape — neither Option 1 (`getMarkRects?:`, optional) nor Option 3 (splitting into a package-provided type and a narrower host-must-supply type) is done here.
- Filing or scoping the Option 3 follow-up issue itself — this spec names it as recommended future work (informed by Zusammen #126, per ADR-089) but does not create it.
- Any code change in `liminis-app` or Zusammen (not triggered — see FR-008).
- Any change to `docs/editor-api.md`.
- Cutting a new release, publishing to npm, or creating a new release tag.

## Source References

- `CHANGELOG.md`, `## 0.2.0` section, "Added" bullet for `getMarkRects` (#73) — the entry being corrected.
- GitHub Release notes for tag `v0.2.0` (`gh release view v0.2.0`), "## Added: `getMarkRects()`" section — the second artifact carrying the same framing.
- `src/annotations/types.ts:211-232` — `AnnotationEditorHandle`; unchanged by this issue.
- `README.md`'s `> **This is \`0.x\`.**` versioning-policy callout.
- Commit `d6a3b8b` ("docs(changelog): correct two false claims about consumer migration") — precedent for in-place historical correction of this same `0.2.0` section.
- `docs/decisions/adr-089.md` — the decision that added `getMarkRects`; names Zusammen #126 as the reason more positional capability is coming, motivating the Option 3 follow-up recommendation.
- `specs/73-expose-on-screen-rects/spec.md` — the original spec for `getMarkRects` itself.

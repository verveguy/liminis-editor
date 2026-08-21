# ADR-92: The Lexical Peer Range Bumps Forward by a Narrow Single Caret, Never a Wide Band

**Date:** 2026-08-20
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #92 (verveguy/liminis-editor)

## Context

Every published version of `@liminis/editor`, including `0.2.2`, declared its
Lexical peer range as `^0.44.0` across all twelve Lexical family packages
(`lexical` and eleven `@lexical/*` scoped packages). Lexical itself moved on
to `0.49.0`. Because Lexical is a `0.x` package, `^0.44.0` resolves under
semver to `>=0.44.0 <0.45.0` — it admits patch releases of 0.44 only, and
excludes every 0.45+ release regardless of whether that particular release
was actually breaking. The practical effect: this package pinned every host
application to a Lexical line five minors behind, with no published version
offering a path forward.

This surfaced while refreshing `liminis-app`'s dependencies
(verveguy/liminis#1026): the Lexical family was bumped 0.44.0 → 0.49.0 and
tested in isolation there. It passed `liminis-app`'s own typecheck, lint,
build, and 3275-test suite — and was still wrong, because `liminis-app` would
have shipped in violation of this package's declared peer contract. That
app's suite does not exercise the editor deeply enough for a green run to be
evidence of Lexical compatibility; the only suite that can answer that
question is this package's own.

The peer-range shape was an open question, not a foregone conclusion: widen
the range to admit 0.44 through 0.49 (matching the issue's own suggested
example), or narrow it to `^0.49.0` and drop 0.44–0.48 support outright.

## Decision

**The twelve Lexical peer ranges move to `^0.49.0` — a narrow single-caret
bump, not a wide multi-version band.** This is a deliberate, permanent
policy choice about how this package treats Lexical peer ranges going
forward, not a one-time bump: every future Lexical minor this package adopts
gets the same treatment — the range moves forward by exactly one caret,
paired with running the full suite against the new version, rather than
widening to claim a span of untested minors as compatible.

### Why narrow, not wide

**Widening a peer range later is patch-safe; narrowing one is breaking.**
Starting narrow keeps both options open — if a wide band is ever wanted, it
can be added without breaking anyone. Starting wide commits the package to a
claim it can only walk back by breaking whoever relied on the wide end.

**This package's existing range philosophy for `react` does not transfer to
Lexical.** The `//peerDependencies` manifest comment already documents that
ranges are "the compatibility contract, not the tested matrix," and that
narrowing `react`'s range to match its `devDependency` version "would only
reject working consumers." That reasoning is sound for React specifically
*because* React's untested span sits inside a **stable major** — a
regression there is a bug in React, not a permitted outcome of its
versioning scheme. Lexical is `0.x`, where semver explicitly permits every
minor release to be breaking. A range like `>=0.44.0 <0.50.0` would assert
compatibility with six minors, five of them never run against this
package's own suite — a materially different, and unjustified, claim.

**No known consumer wants Lexical 0.44.** Both known consumers of this
package (`liminis-app` and the package's own test/build pipeline) are moving
*toward* 0.49, not sitting on 0.44 and wanting to stay there. The wide
band's benefit — "don't reject a working consumer on an old version" — is
close to hypothetical here, while its cost — asserting untested compatibility
across four intermediate minors known to contain breaking changes (see
Consequences) — is real.

A wide band remains available later, but only backed by CI matrix testing
across the band's endpoints — that is separate work, out of scope for this
decision.

### What was verified before this decision was acted on

The twelve packages were bumped to `0.49.0` in both `peerDependencies` and
`devDependencies` (kept in lockstep, per this package's existing pairing
between the tested version and the declared floor), and the full
verification chain — `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm test` (1591 tests), and `pnpm verify:package` (the packed-tarball
install-and-typecheck check against a fresh consumer) — ran clean with **no
source changes required**, despite Lexical's own changelog listing several
breaking changes in the 0.45–0.49 window (a `config()` protocol rework for
node classes in 0.49.0; `insertNodes` linebreak-handling changes and a
deprecated-export removal in 0.46.0; selection/backspace/reconcile changes
in 0.45.0). This package's sixteen custom Lexical node classes all define
explicit `getType`/`clone`/`importJSON` statics rather than relying on
auto-synthesis, which structurally avoided the highest-risk part of the
0.49.0 change; the rest of the changelog's items apparently do not intersect
this package's actual usage patterns, since the suite exercises them and
passed unmodified.

## Consequences

**Positive:**

- Consumers can now install this package alongside the current Lexical
  release; the multi-minor stall the issue described cannot recur until
  Lexical ships another minor this package hasn't yet adopted.
- The Lexical peer range's compatibility claim is now backed by an actual CI
  run against the exact version it names — peer and devDependency are both
  `0.49.0`, so no untested span exists in it. (React's own range still has
  an intentionally untested lower half — peer `^19.2.0` vs. devDependency
  `^19.2.5` — per the `//peerDependencies` note; that is unchanged by this
  decision and follows the opposite, stable-major reasoning explained
  above.)
- The policy is written down (`//lexicalPeerPolicy` in `package.json`, this
  ADR, and the README's install section), so the next Lexical minor is a
  known, bounded task rather than a rediscovery of this issue's reasoning.

**Negative:**

- **This is a breaking change.** `^0.44.0` and `^0.49.0` are non-overlapping
  ranges; any consumer still on Lexical 0.44.0–0.48.x will see an
  unmet-peer-dependency warning on installing the next release and must
  upgrade its Lexical family to 0.49.0 first. That is the intended effect of
  narrowing, not a regression.
- **The stall this issue describes will recur at every future Lexical
  minor**, by design: this package's range never gets ahead of what it has
  actually tested. The mitigation is that each recurrence is now a known,
  bounded task (bump twelve versions, run the suite, adjust the range) with
  a written rationale, rather than an accumulating five-minor gap discovered
  incidentally by a downstream consumer's dependency refresh.

**Neutral:**

- `react`/`react-dom` peer ranges and all non-Lexical dependencies are
  unaffected; this decision only concerns the Lexical family, and does not
  reopen or alter the existing React range philosophy.
- No Lexical-API-floor guard test (the kind `tests/package-manifest-contract.test.ts`
  already has for React) was added. That guard exists for React because its
  range makes an untested-lower-half claim that needs policing; the narrow
  Lexical range makes no such claim, so there is nothing analogous to guard
  against.

## References

- Issue #92 (this decision), verveguy/liminis#1026 (the originating
  `liminis-app` dependency refresh that surfaced the stall)
- `package.json` — the `//peerDependencies` and `//lexicalPeerPolicy`
  manifest comments; the twelve `peerDependencies`/`devDependencies` entries
- `README.md` — "Install" section, the Lexical `pnpm add` block and the
  peer-range policy callout
- `CHANGELOG.md` — the `## Unreleased` / `### Breaking changes` entry
  recording this bump
- `docs/decisions/adr-078.md`, `docs/decisions/adr-079.md` — prior ADRs on
  consumer-facing package surface, cited as precedent for treating this as
  ADR-worthy
- Related: #78 (a required member made 0.2.0 type-level breaking), #79
  (token definitions documented as public API) — prior instances of
  consumer-facing surface needing explicit treatment

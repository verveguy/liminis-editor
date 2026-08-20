# @liminis/editor — working conventions

Conventions specific to this repository. Where a rule exists because something
went wrong, the reason is recorded — a rule whose motivation is lost gets
"tidied away" by the next person.

## Decision records

ADRs live in `docs/decisions/` and are named:

```
adr-<issue-number>-<short-slug>.md
```

for example `adr-84-markdown-outline-source.md`, recording the decision taken
for issue #84. This mirrors the spec convention, `specs/<issue>-<slug>/`.

**Why the issue number.** It is unique before the work starts. The previous
rule — "take the next free number" — allocates at *write* time, when two
branches cannot see each other. On 2026-08-19 issues #79 and #84 both produced
an `adr-091.md`: both branches were green, both were reviewed, and the clash
surfaced only when the second one merged. Nothing detects that earlier, and it
will recur whenever two issues touch `docs/decisions/` concurrently.

**Why the slug.** It says what the record is about, so `docs/decisions/` can be
read as an index without opening 27 files. Same reasoning as the spec
directories.

**Do not renumber existing ADRs.** `adr-002` … `adr-092` predate this rule and
stay exactly as they are, cited by number from code comments, other ADRs and
specs across three repositories. The two schemes coexist; a bare `ADR-078` is a
legacy record, an `ADR-84-…` is an issue-numbered one.

Note the ranges overlap: this repository's issue numbers (1–90ish) sit inside
the inherited sequential range (002–092), so `adr-84-<slug>.md` and `adr-084.md`
can both exist and mean different things. That is why the slug is not optional.

**Every ADR carries this header**, and `**Issue:**` is what makes the filename
verifiable:

```markdown
# ADR-<issue>: <Title>

**Date:** YYYY-MM-DD
**Status:** Accepted
**Supersedes:** none
**Amends:** none
**Issue:** #<n> (verveguy/liminis-editor)
```

**Amend; do not rewrite.** When a decision stops holding, append a dated
amendment block rather than editing the original text:

```markdown
> **Amended YYYY-MM-DD — this clause no longer holds.** …
```

See `adr-077.md` and `adr-078.md`. An ADR is a record of what was decided and
why, including decisions later reversed; silently editing one destroys the only
evidence of the reasoning. ADR-078 has been amended twice — once when the
package was published, once when `publishConfig` turned out not to work — and
both amendments are more useful than the corrected text would have been.

**Record what a decision costs, not only what it buys.** Two extractions this
month shipped a plan listing the upside of a choice and omitting the capability
it removed — raw-mode outline support (#84) and compile-time compatibility for
interface implementors (#78). Both were found by migrating a real consumer,
after release. If a decision closes off something that previously worked, say
so in the ADR even when the trade is clearly worth it.

## Releases

- **`0.x` semver: the minor is the breaking slot.** `^0.2.0` matches `0.2.1`
  and does not match `0.3.0`. An additive change released as a minor forces
  every consumer to raise its range for something that takes nothing away —
  release additive work as a patch.
- **Do not bump a version that is already unreleased.** Check whether
  `package.json`'s version has actually shipped before raising it; several
  changes may be accumulating under one unreleased number deliberately, so that
  consumers absorb one upgrade rather than several.
- **`package.json` and the CHANGELOG heading must agree.** `publish.yml`
  refuses a release whose tag and manifest disagree. A change landing between
  releases writes under `## Unreleased`, not under a guessed next version.

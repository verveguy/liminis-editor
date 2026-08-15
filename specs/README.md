# Specs

The requirements history of `@liminis/editor`, carried across when the package
was extracted from the Liminis monorepo.

Each directory is `<issue-number>-<slug>`, where the number is the GitHub issue
in **`verveguy/liminis`** that produced it — these predate this repository, so
the numbers do not refer to issues here.

| spec | what it decided |
|---|---|
| `938-extract-the-lexical-markdown` | Phase 1 — carving the editor into a package with a curated public surface (ADR-075) |
| `939-phase-2-unified-annotation` | Phase 2 — comments and corrections as two configurations of one annotation mechanism (ADR-077) |
| `940-phase-3-oss-hardening` | Phase 3 — a real build, `.d.ts`, peer dependencies, vendoring the wiki-link patch |
| `943-pull-up-zusammen-s` | markdown round-trip idempotency fixes pulled up from Zusammen |
| `951-…-make-wiki` | wiki-link promotion on export made configurable |
| `952-…-drop-crossorigin` | `crossOrigin` removed from remote images |
| `953-…-adopt-github` | GitHub-style slug matching and scroll-container discovery for anchors |
| `954-…-export-the` | the `./nodes` entry point |
| `961-…-a-toolbar` | a `toolbar`-surfaced annotation kind made reachable |
| `965-…-the-toolbar` | that affordance made reachable in a **read-only** editor |
| `970-…-overlapping-annotations` | overlapping marks placed, and live ranges kept out of inline syntax |
| `973-markdown-serializer-non-idempotent-emphasis` | emphasis/strong adjacent to inline code keeping its wrapper |

The six from `951` onward were all found by Zusammen adopting this package as
its editor — the first consumer outside the monorepo. They are worth reading
together: each is a gap that only became visible once a second application
depended on the public surface.

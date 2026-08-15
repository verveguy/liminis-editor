# Architectural Decision Records

The decisions that govern this package. Each one is a **verbatim copy** of the
record as it stood in `verveguy/liminis` at commit `34f0d828`, the point at which
this package was extracted into its own repository (verveguy/liminis#995).

| ADR | Title |
|-----|-------|
| [ADR-075](adr-075.md) | The `@liminis/editor` Package Boundary Is Drawn at Persistence |
| [ADR-076](adr-076.md) | Markdown Serialization Is a Fixed Point, at the Cost of a One-Time Canonicalization |
| [ADR-077](adr-077.md) | Comments and Corrections Are Two Kinds of One Annotation Mechanism |
| [ADR-078](adr-078.md) | `@liminis/editor` Is Delivered by a Non-Bundling `tsc` Emit Behind `publishConfig` |
| [ADR-079](adr-079.md) | A Seventh Export Subpath, `./nodes`, for the Headless Mapper |

## Why these five, and why copies rather than moves

These are the ADRs that the package's own source cites. ADR-075, ADR-077 and
ADR-078 are cited from the host application as well, so removing them from
`verveguy/liminis` would have left dangling citations *there*. ADR-076 and
ADR-079 are package-only, but were copied rather than moved so that the source
repository's decision index has no holes in its numbering.

The duplication is deliberate and it is a known cost: two copies can diverge.
Reconciling them is a single pass scheduled against a settled repository, as part
of the eventual decision to make this repository public. Until then, treat the
copies here as the record for questions about the package and the originals as
the record for questions about the application.

## Numbers cited inside these documents that are not in this table

The bodies below cite other ADRs — ADR-002, 007, 008, 010, 012, 024, 025, 027,
034, 042, 057, 070, 080. Those are decisions about the **host application**, not
about this package, and they are not reproduced here; importing them would drag
most of an unrelated decision index in behind them.

They are not dangling. Every one of them resolves in the source repository, at
`docs/project_notes/decisions/adr-0NNN.md` in `verveguy/liminis`.

The documents are kept byte-identical to their originals rather than rewritten to
remove those references. Rewriting them would fork the two copies on day one and
make the reconciliation pass above a manual read instead of a `diff`. Where one
of those application decisions was cited *by this package's own code*, the
citation was removed and its reasoning inlined at the call site instead — see
`docs/provenance.md`.

## Cross-references to records that stayed behind

These records were extracted from a larger decision log. Where one of them cites
an ADR that is **not** in this directory, that record is a Liminis *application*
decision — about the Electron shell, IPC, agent integration, the knowledge graph
or settings persistence — which deliberately did not travel, because it does not
govern this package.

Currently referenced but not present:

| cited | what it is | cited by |
|---|---|---|
| ADR-003 | Claude Agent SDK for AI integration | `adr-080` |
| ADR-008 | MCP server integration with per-chat permissions | `adr-077`, `adr-080` |
| ADR-012 | Component/BOM system for workspace tracking | `adr-077`, `adr-080` |
| ADR-032 | Main process owns all state; renderer is reactive | `adr-080` |
| ADR-034 | Claude Code configuration strategy | `adr-075` |
| ADR-042 | Context graph concurrent read/write architecture | `adr-075`, `adr-077` |
| ADR-055 | Atomic, serialized settings persistence | `adr-057` |

Chasing these to closure would import most of an 81-record log describing an
application this package does not depend on. The citations are left intact
rather than edited out, so the records stay verbatim copies and the reasoning
remains traceable for anyone who does have access to the Liminis repository.

**No document outside `docs/decisions/` cites a missing record** — the package's
own documentation (`README.md`, `docs/*.md`) is self-contained.

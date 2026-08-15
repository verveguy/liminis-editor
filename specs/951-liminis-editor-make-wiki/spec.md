# Feature Specification: Make wiki-link promotion on markdown export configurable

**Feature Branch**: `fabrik/issue-951`
**Created**: 2026-08-06
**Status**: Draft
**Input**: User description: "`packages/editor`'s `convertLinkNode` (markdown export, `lexicalToMdast`) unconditionally promotes a relative link to wiki-link syntax when the link has no title: a link to a relative `.md` path, a bare anchor, or a directory is emitted as `[[target|text]]` rather than `[text](target)`. liminis#919 fixed the *titled* case; the untitled promotion remains, and there is no option, prop, or host-service seam to turn it off. For a wiki-link-native product this is intended behaviour. For a consumer whose documents live in a git repository rendered by the GitHub web UI, it is document corruption: every untitled relative link is rewritten on every save into syntax GitHub does not render. Expose wiki-link emission as configuration, defaulting to today's behaviour so `liminis-app` is unaffected."

## Background

`packages/editor`'s markdown export path (`exportLexicalToMdast` in `lexicalToMdast.ts`, via `convertLinkNode`'s `isWikiLinkUrl` check) promotes any *untitled* link whose URL looks like a relative note reference — a relative `.md` path, a bare `#anchor`, or a directory-style path (trailing slash) — into Obsidian-style wiki-link syntax (`[[target]]` / `[[target|alias]]`) on export. This is deliberate, existing behavior for a wiki-link-native product: `liminis-app` treats such links as note-to-note references and wants them round-tripped as wiki-links. [#919](https://github.com/verveguy/liminis/issues/919) already fixed the narrower case where the link carries a *title* — a title now always suppresses promotion, since wiki-link syntax has no slot for one. This issue is about the remaining, and much more common, untitled case, where promotion still fires unconditionally today.

The problem is that this heuristic is not optional. For `liminis-app`, whose documents are wiki-link-native, that's correct. But `verveguy/zusammen` is adopting `@liminis/editor` as a dependency for a product whose documents live in a plain git repository and are rendered by the GitHub web UI. GitHub does not render `[[target|text]]` syntax — it renders literal brackets. Every untitled relative link a Zusammen user writes is silently rewritten into non-rendering syntax the moment the document round-trips through the editor (e.g. on save), which is document corruption from that consumer's point of view, not a normalization. Zusammen already carries a fork-local patch for this (`verveguy/zusammen#27`), and that patch — turning the fork back into a plain dependency on the upstream package — is the one thing still blocking Zusammen's adoption of `@liminis/editor` as an ordinary dependency (`verveguy/zusammen#102`).

`@liminis/editor` has a deliberately curated public export surface (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`, `./styles.css`) that consumers are expected to import from without reaching into package internals. The package already has precedent for host-configurable export/rendering behavior reaching the `App`/`Editor` component surface as an optional prop (e.g. `imagePathResolution` on `Editor`, threaded down from `App`). This issue asks for the same kind of seam for wiki-link promotion: a way for a consumer to say "don't do this," reachable from the declared public entry points, defaulting to today's promote-on-export behavior so `liminis-app` needs no changes.

Wiki-link *parsing on import* (recognizing `[[target]]` / `[[target|alias]]` syntax written by the user and turning it into a link node) is a separate, unrelated concern and is explicitly not part of this issue — a consumer that opts out of promotion on export can still open a document containing genuine wiki-links and have them parsed correctly on import.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consumer opts out of wiki-link promotion (Priority: P1)

A host application embeds `@liminis/editor` and configures it, via the package's public entry points, to never promote untitled relative links to wiki-link syntax on export. A user of that host writes a standard markdown link to another file in the same repository, e.g. `[notes](notes.md)`, with no title. When the document round-trips through the editor (e.g. on save), the link comes back exactly as written — `[notes](notes.md)` — not rewritten to `[[notes|notes]]`.

**Why this priority**: This is the core ask and the one thing blocking `verveguy/zusammen`'s adoption of the package as a plain dependency. Without it, every untitled relative link in that consumer's documents is corrupted on every save.

**Independent Test**: A new round-trip fixture pair (opt-out configuration active) containing an untitled relative `.md` link, a bare `#anchor` link, and a directory-style link each round-trips as a standard markdown link, byte-identical to the input, and a second round trip of that output is also byte-identical (idempotent).

**Acceptance Scenarios**:

1. **Given** the wiki-link promotion option is set to "do not promote," **When** a document containing `[notes](notes.md)` (untitled, relative `.md` path) round-trips through the editor with no edits, **Then** the output is byte-identical to the input.
2. **Given** the same opt-out configuration, **When** a document containing an untitled bare-anchor link (e.g. `[section](#section)`) or an untitled directory-style link (e.g. `[folder](folder/)`) round-trips through the editor, **Then** each comes back as a standard markdown link, byte-identical to its input.
3. **Given** the same opt-out configuration, **When** the already-round-tripped output from scenario 1 or 2 is round-tripped a second time with no edits, **Then** the second-pass output is byte-identical to the first-pass output.
4. **Given** the wiki-link promotion option is set to "do not promote," **When** a document contains a genuine, author-written wiki-link (`[[some-note]]` or `[[some-note|alias]]`), **Then** it is still parsed correctly on import (wiki-link parsing on import is unaffected by this option, which governs export only).

---

### User Story 2 - Default behavior is unchanged for existing consumers (Priority: P1)

`liminis-app` and any other consumer that does not set the new option continue to get exactly today's behavior: an untitled relative `.md` link, bare anchor, or directory-style link is promoted to wiki-link syntax on export, unchanged.

**Why this priority**: This is the non-negotiable compatibility constraint the issue is built around — the option must be additive and default-off (i.e. default to "promote," today's only behavior), or `liminis-app` regresses.

**Independent Test**: The full existing round-trip fixture corpus — including `relative-md-link-without-title` — is run with the option left unset and produces byte-identical output to today, with no fixture changes required to the existing corpus.

**Acceptance Scenarios**:

1. **Given** the wiki-link promotion option is left unset (or explicitly set to its default), **When** the existing round-trip fixture corpus is run — including `relative-md-link-without-title` (which promotes `[note](notes.md)` to `[[notes|note]]`) — **Then** every fixture's output is byte-identical to today's output, with no changes to existing fixture files.
2. **Given** `liminis-app` embeds the editor without passing the new option, **When** a user's document is saved, **Then** untitled relative links continue to be promoted to wiki-link syntax exactly as they are today.

---

### Edge Cases

- An untitled relative `.md` link with an anchor (e.g. `[note](notes.md#section)`) must, under the opt-out configuration, round-trip as a standard link unchanged — the option must apply uniformly to every URL shape `isWikiLinkUrl` currently classifies as wiki-link-like (relative `.md` path with or without a leading `./`/`../`, `.md` path with an anchor, directory-style path, bare anchor), not just the simplest case.
- A **titled** link (any URL shape) must never be promoted regardless of this option's value — that is already guaranteed by [#919](https://github.com/verveguy/liminis/issues/919) and is unaffected by this issue; the new option only changes behavior for the *untitled* case that #919 explicitly left alone.
- A genuine author-written wiki-link (`[[target]]` / `[[target|alias]]`) must continue to round-trip unchanged regardless of the option's value — the option governs whether a *standard link* gets promoted on export, not how existing wiki-link syntax is handled.
- Repeated round-trips under the opt-out configuration must be idempotent (no drift on a second pass with no edits), matching the idempotence guarantee the existing fixture corpus already enforces for the default configuration.
- The option must be reachable by a consumer that only imports from the package's declared public entry points (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`) — not via a deep import into package internals (e.g. directly importing `lexicalToMdast.ts`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The markdown export path MUST accept a configuration setting that controls whether an untitled relative link (relative `.md` path, `.md` path with anchor, bare `#anchor`, or directory-style path) is promoted to wiki-link syntax (`[[target]]` / `[[target|alias]]`) or emitted as a standard markdown link (`[text](target)`).
- **FR-002**: The default value of this setting, when unset, MUST reproduce today's behavior exactly: promote every untitled link of the shapes above to wiki-link syntax. No existing round-trip fixture's output may change as a result of this feature.
- **FR-003**: The editor/`App` component surface that reaches the markdown export path MUST expose this same setting as an optional prop or equivalent configuration input, so a host application can set it without reaching past the component boundary.
- **FR-004**: The setting MUST be reachable, end to end, from a consumer that only imports from the package's declared public entry points (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`) — no deep import into package internals may be required to use it.
- **FR-005**: When the setting selects "do not promote," an untitled relative `.md` link, an untitled `.md`-with-anchor link, an untitled bare-`#anchor` link, and an untitled directory-style link MUST each round-trip as a standard markdown link (`[text](target)`), byte-identical to their input.
- **FR-006**: Round-tripping under "do not promote" MUST be idempotent: feeding the first-pass output back through the same pipeline with no edits MUST produce byte-identical output to the first pass.
- **FR-007**: This setting MUST NOT affect wiki-link *parsing on import* — a document containing genuine `[[target]]` / `[[target|alias]]` syntax must continue to parse into a link/wiki-link node the same way regardless of the setting's value.
- **FR-008**: This setting MUST NOT affect the titled-link case already governed by [#919](https://github.com/verveguy/liminis/issues/919) — a titled link is never promoted, independent of this setting's value.
- **FR-009**: At least one new round-trip fixture pair MUST be added to the corpus (`packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/`) exercising the opt-out configuration: an untitled relative `.md` link, an untitled bare-`#anchor` link, and an untitled directory-style link, each verified to round-trip as a standard link, byte-identical and idempotent, under "do not promote."
- **FR-010**: The full existing round-trip fixture corpus MUST continue to pass unchanged with the setting left unset (default), including `relative-md-link-without-title` and the existing wiki-link test suites (`wiki-link-format.test.ts`, `parse.test.ts`, `stringify.test.ts`).

### Key Entities

- **Wiki-link promotion setting**: the new configuration value this issue introduces — two states, "promote" (default, today's behavior) and "do not promote" (new). Governs export only.
- **Markdown export path** (`exportLexicalToMdast`, `convertLinkNode`, `isWikiLinkUrl` in `lexicalToMdast.ts`): where the setting takes effect — the point that currently decides, from URL shape and title presence alone, whether a link node is emitted as wiki-link or standard-link mdast.
- **Editor/`App` component surface**: the React component boundary (`Editor`, `App`) through which a host application already passes similar export/rendering configuration (e.g. `imagePathResolution`) and through which this setting must also be reachable.
- **Public package entry points**: the declared `exports` map of `@liminis/editor` (`.`, `./markdown`, `./annotations`, `./headless`, `./contract`, `./styles.css`) — the setting must be usable through these without a deep import.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the setting unset, the full existing round-trip fixture corpus produces byte-identical output to today's, with zero fixture files modified.
- **SC-002**: With the setting set to "do not promote," an untitled relative `.md` link, an untitled bare `#anchor` link, and an untitled directory-style link each round-trip to `[text](target)`, byte-identical to input, and a second round trip of that output is byte-identical to the first.
- **SC-003**: A consumer that imports only from `@liminis/editor`'s declared public entry points (no deep import) can set the option and observe the "do not promote" behavior end to end, from the `App`/`Editor` component surface down to markdown export.
- **SC-004**: A new fixture pair covering the opt-out configuration exists in the round-trip corpus and passes.

## Assumptions

- "Relative link" in this issue means the same set of URL shapes `isWikiLinkUrl` already classifies as wiki-link-like today: relative `.md` paths (with or without a leading `./`/`../`), `.md` paths with an anchor, bare `#anchor` links, and directory-style (trailing-slash) paths. The new setting is a uniform on/off switch over that existing classification, not a redefinition of which URLs qualify.
- The exact name, type (e.g. boolean vs. enum), and default-value spelling of the setting, and precisely how it is threaded from the `App`/`Editor` props down to the markdown export function's parameters, are implementation decisions for the Research/Plan stages — this spec fixes the required behavior and the required reachability (public entry points, `App`/`Editor` surface, markdown export path), not the concrete API shape.
- How the round-trip fixture test harness is extended to exercise a non-default configuration (e.g. a per-fixture or per-directory option, or a separate test file/suite) is likewise a Research/Plan-stage decision; this spec requires only that such coverage exists and passes.
- Titled links are already handled correctly regardless of this setting (per #919) and require no further changes here.

## Out of Scope

- Any change to wiki-link *parsing* on import — recognizing `[[target]]` / `[[target|alias]]` syntax and turning it into a link node is unaffected by this issue.
- Any change to the titled-link behavior already fixed by [#919](https://github.com/verveguy/liminis/issues/919).
- Any change to which URL shapes `isWikiLinkUrl` classifies as wiki-link-like (i.e. no change to the promotion heuristic's *classification* logic) — only whether promotion fires at all becomes configurable.
- Changing `liminis-app`'s default behavior or requiring any change to how `liminis-app` embeds the editor.
- A user-facing UI toggle inside the editor itself for switching this behavior interactively; this is a host-application-level configuration setting, not an in-editor preference.
- The other gaps tracked separately under the `verveguy/zusammen#102` parent decomposition.

## Source References

- `packages/editor/src/app/mapper/lexicalToMdast.ts` — `exportLexicalToMdast`, `convertLinkNode`, `isWikiLinkUrl` (the export-side promotion logic this issue makes configurable).
- `packages/editor/src/app/editor/Editor.tsx` — the `Editor` component's existing optional-prop pattern for host-configurable export/rendering behavior (e.g. `imagePathResolution`, `assetBaseUri`), precedent for how this setting should reach the component surface.
- `packages/editor/src/app/App.tsx` — how `Editor` props like `imagePathResolution` are threaded down from `App`-level settings.
- `packages/editor/src/index.ts`, `packages/editor/package.json` (`exports` map) — the package's declared public entry points the new setting must be reachable through.
- `packages/editor/src/markdown/parse.ts` (`ParseOptions`), `packages/editor/src/markdown/stringify.ts` (`StringifyOptions`) — existing precedent for optional-settings objects on the markdown pipeline.
- `packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/relative-md-link-without-title.md` / `.expected.md` — the existing fixture whose current (promote) output must stay byte-identical when the new setting is unset.
- `packages/editor/src/app/mapper/__tests__/fixtures/roundtrip/README.md` — fixture corpus conventions the new opt-out fixture pair must follow.
- `specs/919-relative-md-links-with/spec.md` — the prior, related fix for the titled-link case this issue explicitly leaves unaffected.
- [verveguy/zusammen#27](https://github.com/verveguy/zusammen/issues/27) — Zusammen's fork-local patch this issue is meant to make unnecessary.
- [verveguy/zusammen#102](https://github.com/verveguy/zusammen/issues/102) — the parent issue tracking Zusammen's adoption of `@liminis/editor`, of which this is one of four sub-issues.

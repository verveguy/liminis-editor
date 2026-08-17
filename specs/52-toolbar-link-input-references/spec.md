# Feature Specification: Fix invalid `--vscode-text` reference in toolbar link input

**Feature Branch**: `fabrik/issue-52`
**Created**: 2026-08-17
**Status**: Specified
**Input**: User description: "`src/styles.css:872` reads `color: var(--vscode-text);` inside `.toolbar-link-input input`. There is no `--vscode-text` token anywhere in the package. The intended one is `--vscode-foreground`, which is what the other 53 references use."

## Background

`src/styles.css` consumes 60 custom properties from the VS Code theming contract. Every one of them has either a default declared in `styles.css` or an inline fallback (`var(--x, var(--y))`) — except `--vscode-text` at line 872, which is the sole exception. Because unresolved CSS custom properties are simply dropped rather than raising an error or warning, this has never surfaced as a visible failure in tooling, tests, or linting.

The practical effect: the toolbar's link-input text colour silently falls back to the browser's inherited colour instead of the editor foreground colour. On hosts where the inherited colour happens to be close to the intended foreground colour, the bug is invisible; on hosts where it isn't, the input text renders in the wrong colour with no diagnostic trail pointing at the cause.

This was discovered while inventorying the theming contract for issue #50 (a drift guard that will assert every consumed custom property has a default or fallback). The two custom properties immediately surrounding this line are both handled correctly, and all 53 other appearances of the foreground token in this file already use the correct name `--vscode-foreground` — indicating this is an isolated typo/slip introduced when the toolbar was originally written, not a deliberate or design-level choice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link input text takes the editor foreground colour (Priority: P1)

As a user of the editor's toolbar link-input feature (opening the link-entry popover from the toolbar), I see the input's text rendered in the same foreground colour as the rest of the editor's UI, regardless of which host page or theme the editor is embedded in.

**Why this priority**: This is the entire scope of the issue — a single incorrect CSS custom property reference causing a visible, theme-dependent styling defect.

**Independent Test**: Open the toolbar's link-input popover in the running editor (or a host page with a non-default inherited text colour) and visually confirm the input text renders in the editor's foreground colour rather than an inherited or default browser colour.

**Acceptance Scenarios**:

1. **Given** the editor is embedded in a host page where the browser's inherited text colour differs from `--vscode-foreground`, **When** the toolbar link-input popover is opened, **Then** the input's text colour matches `--vscode-foreground`, not the inherited colour.
2. **Given** the editor is in its default/light and dark theme configurations, **When** the toolbar link-input popover is opened, **Then** the input text remains legible and consistent with the rest of the toolbar's text colour in both themes.

### Edge Cases

- Hosts that do not define `--vscode-foreground` at all: `styles.css` already declares defaults for `--vscode-foreground` (see lines 15 and 70), so the input still resolves to a sensible colour rather than becoming unresolved again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `color` declaration in the `.toolbar-link-input input` rule (`src/styles.css:872`) MUST reference `--vscode-foreground` instead of the nonexistent `--vscode-text`.
- **FR-002**: No other property, selector, or rule in `src/styles.css` is to be changed as part of this fix.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `src/styles.css` contains zero references to `--vscode-text`.
- **SC-002**: Visual confirmation (by eye, since no automated check exercises this) that the toolbar link-input's text colour takes `--vscode-foreground` in the running editor.

## Assumptions

- `--vscode-foreground` is the correct intended token, consistent with its use in all 53 other occurrences in `src/styles.css` and consistent with the two neighbouring, correctly-handled declarations in the same rule block.
- No test currently exercises this CSS property and none is expected to be added as part of this fix — verification is visual, as stated in the issue.
- The broader drift-guard assertion (checking that every consumed custom property has a default or fallback) is out of scope here and is tracked separately under issue #50.

## Out of Scope

- Adding automated tooling or tests to detect unresolved CSS custom properties generally (tracked under issue #50).
- Any other styling or theming changes to `src/styles.css`.

## Source References

- `src/styles.css:872` — the incorrect declaration.
- Issue #50 — the theming-contract drift guard that surfaced this bug and that would prevent recurrences of this class of bug.

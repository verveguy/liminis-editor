#!/usr/bin/env node
/**
 * Shared extraction logic for the theming-contract inventory (verveguy/liminis-editor#50,
 * renamed off the --vscode-, --slashmd-, --color- and --checkbox- prefixes by #51).
 *
 * `scripts/generate-theming-docs.mjs` (writes the README table) and
 * `tests/theming-contract.test.ts` (the drift guard) both import this module
 * rather than re-implementing the scan — the guard is only meaningful if the
 * generator and the checker agree on what "consumed" and "documented" mean.
 *
 * Every function here is pure and takes its inputs explicitly (a source root,
 * a stylesheet path, a block of markdown) so both the CLI script and vitest
 * can point it at either the real repo or a throwaway fixture directory.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/** Strip `/* ... *\/` comments from CSS text (no nested comments in CSS). */
export function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Strip `//` and `/* ... *\/` comments from JS/TSX text, comment-aware. */
export function stripJsComments(text) {
  // Removes block comments, then line comments — sufficient for this
  // codebase, which never puts `//` inside a string on the same line as a
  // `var(--...)` reference. Not a full tokenizer.
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CSS_EXTENSIONS = new Set(['.css'])
const JS_EXTENSIONS = new Set(['.ts', '.tsx'])

/** Recursively list files under `root` whose extension is in `extensions`. */
function listFiles(root, extensions) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { encoding: 'utf-8' })) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (extensions.has(extname(entry))) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

const TOKEN_RE = /--[a-zA-Z0-9-]+/.source

/**
 * True iff the `var(` starting at `varStartIndex` is itself the entire value
 * of a custom-property *declaration* — e.g. the `var(--vscode-foreground)` in
 * `--liminis-editor-foreground: var(--vscode-foreground);` (ADR-93's
 * definition-side alias layer, #93). Found by walking back from `varStartIndex`
 * to the nearest statement boundary (`;`, `{` or `}`) and checking whether
 * everything between that boundary and `var(` is exactly `--name:` — the
 * shape only a custom-property declaration's value position can have (an
 * ordinary CSS property name never starts with `--`).
 *
 * This distinguishes a *definition-site* var() (aliasing one custom property
 * to another) from a *consumption-site* var() (a host-facing "read this
 * token" reference) — the two are syntactically identical `var(--x)` calls,
 * but only the latter belongs in `consumedTokens()`'s inventory. Without this
 * check, #93's alias declarations would each register their legacy-name
 * target as a newly "consumed" token, growing the README/description
 * surface for a token no host-facing code actually reads.
 */
function isCustomPropertyDeclarationValue(text, varStartIndex) {
  const boundary = Math.max(
    text.lastIndexOf(';', varStartIndex),
    text.lastIndexOf('{', varStartIndex),
    text.lastIndexOf('}', varStartIndex),
  )
  const statement = text.slice(boundary + 1, varStartIndex)
  return new RegExp(`^\\s*${TOKEN_RE}\\s*:\\s*$`).test(statement)
}

/**
 * Every `var(--token` consumption site found in `text`, comment-stripped
 * first, walked with a paren-aware scanner so each site carries its `var()`
 * nesting depth and, if its fallback opens with another `var(--y...)` call,
 * that call's token name as `immediateFallback`.
 *
 * The rename (#51) chains every consumption site as
 * `var(--liminis-editor-x, var(--old-name-x, ...))`, so a naive flat regex
 * (matching every `var(--x` occurrence regardless of nesting) would count
 * the old, deprecated name as a second, independently "consumed" token at
 * every one of the 59 sites — doubling the README/description-maintenance
 * surface and violating #51's SC-001 ("a previous-family name appears only
 * as a fallback, never as the primary consumed name"). Depth lets callers
 * keep only depth-0 (primary) sites; `immediateFallback` is what the #51
 * drift-guard check (FR-011) compares against `PREVIOUS_NAME`.
 *
 * `isDeclarationValue` (#93) marks a depth-0 site whose `var()` is itself the
 * value of a custom-property declaration (an alias, not a consumption) — see
 * `isCustomPropertyDeclarationValue`.
 */
function consumptionSitesIn(text) {
  const nameRe = new RegExp(`^\\s*(${TOKEN_RE})\\s*(,)?`)
  const openingFallbackRe = new RegExp(`^\\s*var\\(\\s*(${TOKEN_RE})`)
  const sites = []
  const stack = [] // { type: 'var' } | { type: 'other' }, innermost last
  let i = 0
  const n = text.length
  while (i < n) {
    if (text.startsWith('var(', i)) {
      const rest = text.slice(i + 4)
      const match = nameRe.exec(rest)
      if (match) {
        const depth = stack.reduce((count, frame) => count + (frame.type === 'var' ? 1 : 0), 0)
        // immediateFallback only counts a nested var() that the fallback argument
        // *opens with* (whitespace aside) — e.g. `var(--x, var(--y))`. A nested
        // var() that appears later in the fallback, behind other text, does not
        // count (e.g. `var(--x, 1px solid var(--y))` does not "open with" --y),
        // since that fallback would not resolve to a bare previous-name value.
        let immediateFallback = null
        if (match[2]) {
          const opening = openingFallbackRe.exec(rest.slice(match[0].length))
          if (opening) immediateFallback = opening[1]
        }
        const isDeclarationValue = depth === 0 && isCustomPropertyDeclarationValue(text, i)
        const site = { name: match[1], hasFallback: Boolean(match[2]), depth, immediateFallback, isDeclarationValue }
        sites.push(site)
        stack.push({ type: 'var' })
        i += 4
        continue
      }
    }
    if (text[i] === '(') {
      stack.push({ type: 'other' })
      i++
      continue
    }
    if (text[i] === ')') {
      if (stack.length > 0) stack.pop()
      i++
      continue
    }
    i++
  }
  return sites
}

/**
 * A CSS property name immediately preceding a `var(--token` reference on the
 * same source line, e.g. `color` in `color: var(--liminis-editor-foreground, ...)`.
 * Non-greedy matching means this always captures the first (depth-0) `var()`
 * on the line, never a nested fallback reference. Returns `null` when the
 * token is reached indirectly (assigned to a JS variable first, then
 * interpolated elsewhere) — classification treats that as "no signal"
 * rather than guessing.
 */
function propertyHintsIn(text) {
  const hints = new Map() // token name -> Set<property>
  for (const line of text.split('\n')) {
    const re = new RegExp(`([A-Za-z-]+)\\s*:[^;{}\\n]*?var\\(\\s*(${TOKEN_RE})`, 'g')
    let match
    while ((match = re.exec(line))) {
      const [, property, name] = match
      if (!hints.has(name)) hints.set(name, new Set())
      hints.get(name).add(property.toLowerCase())
    }
  }
  return hints
}

/**
 * Scan `srcRoot` for every custom property `var(--...)` consumes at the
 * top level (depth 0) of a `var()` fallback chain — i.e. the primary name a
 * host is meant to theme, not a nested previous-name fallback (see
 * `consumptionSitesIn`) and not a definition-side alias's own `var()` value
 * (#93 — see `isCustomPropertyDeclarationValue`). Returns a
 * `Map<name, { files: Set<string>, sites: Array<{file, hasFallback, immediateFallback}>, properties: Set<string> }>`.
 */
export function consumedTokens(srcRoot) {
  const cssFiles = listFiles(srcRoot, CSS_EXTENSIONS)
  const jsFiles = listFiles(srcRoot, JS_EXTENSIONS)
  const files = [...cssFiles, ...jsFiles]

  const stripped = new Map()
  for (const file of cssFiles) stripped.set(file, stripCssComments(readFileSync(file, 'utf-8')))
  for (const file of jsFiles) stripped.set(file, stripJsComments(readFileSync(file, 'utf-8')))

  const tokens = new Map()

  // Pass 1: primary (depth-0) consumption sites populate the map — excluding
  // a depth-0 var() that is itself a definition-side alias's value (#93).
  for (const file of files) {
    for (const site of consumptionSitesIn(stripped.get(file))) {
      if (site.depth !== 0) continue
      if (site.isDeclarationValue) continue
      if (!tokens.has(site.name)) {
        tokens.set(site.name, { files: new Set(), sites: [], properties: new Set() })
      }
      const entry = tokens.get(site.name)
      entry.files.add(file)
      entry.sites.push({ file, hasFallback: site.hasFallback, immediateFallback: site.immediateFallback })
    }
  }

  // Pass 2: property hints attach only to names already in the primary map
  // — a hint for a nested (previous-name) reference is discarded.
  for (const file of files) {
    const hints = propertyHintsIn(stripped.get(file))
    for (const [name, properties] of hints) {
      if (!tokens.has(name)) continue
      for (const property of properties) tokens.get(name).properties.add(property)
    }
  }

  return tokens
}

/**
 * Every custom property declared (not consumed) anywhere in `stylesCssPath`,
 * comment-stripped. A declaration is `--name:` — deliberately not restricted
 * to `:root`/`.dark`, since the `@media print` block also declares a subset
 * and this repo's "defined in styles.css" count is a flat "declared
 * anywhere" count. Per #51's compatibility design, defaults stay declared
 * under each token's previous (pre-rename) name — only consumption sites
 * were rewritten to the new `--liminis-editor-*` name — so this continues to
 * report defaults keyed by the old names.
 */
export function defaultedTokens(stylesCssPath) {
  const text = stripCssComments(readFileSync(stylesCssPath, 'utf-8'))
  const re = new RegExp(`(${TOKEN_RE})\\s*:`, 'g')
  const names = new Set()
  let match
  while ((match = re.exec(text))) {
    names.add(match[1])
  }
  return names
}

/**
 * A token resolves without any host supplying anything iff it has a default
 * declaration, or every one of its consumption sites carries an inline
 * fallback. This is the rule issue #52 broke: a token consumed once, with
 * neither a default nor a fallback, silently drops its declaration.
 */
export function resolvesWithoutHost(name, consumed, defaulted) {
  if (defaulted.has(name)) return true
  const entry = consumed.get(name)
  if (!entry || entry.sites.length === 0) return false
  return entry.sites.every((site) => site.hasFallback)
}

/**
 * New `--liminis-editor-*` name -> the specific previous name it replaced
 * (#51). An explicit, checked-in table rather than derived by convention —
 * "strip the new prefix" isn't 1:1 (see the `--checkbox-border` collision
 * note below). Used by the README's "Previous name" column (`buildInventory`)
 * as a historical migration record; it is no longer used to guard a
 * consumption-site fallback (see `resolvesToPreviousName`'s removal, #98 —
 * that guard's premise, a fallback at the consumption site, is superseded by
 * `LEGACY_SHIM_TARGET`'s definition-side shim).
 *
 * `--liminis-editor-primary`'s entry is `--editor-brand`, not `--color-primary`
 * (#98): the package's own brand token is what it now actually shims to,
 * having stopped forwarding to a `--color-*` token it never defined.
 * `--liminis-editor-primary-100`/`-muted-foreground`/`-muted-100` have no
 * entry at all — their previous `--color-*` "name" was never something this
 * package defined either, so recording it as a migration target would imply
 * a relationship (this package once owned `--color-*`) that never existed.
 *
 * One collision required a deliberate suffix change: `--checkbox-border`
 * and `--vscode-border` both strip to the bare suffix `border`; the
 * checkbox token keeps `checkbox-border` so the two remain distinct names.
 */
export const PREVIOUS_NAME = {
  '--liminis-editor-background': '--vscode-background',
  '--liminis-editor-bold-color': '--slashmd-bold-color',
  '--liminis-editor-border': '--vscode-border',
  '--liminis-editor-button-background': '--vscode-button-background',
  '--liminis-editor-button-foreground': '--vscode-button-foreground',
  '--liminis-editor-callout-caution-bg': '--slashmd-callout-caution-bg',
  '--liminis-editor-callout-caution-border': '--slashmd-callout-caution-border',
  '--liminis-editor-callout-important-bg': '--slashmd-callout-important-bg',
  '--liminis-editor-callout-important-border': '--slashmd-callout-important-border',
  '--liminis-editor-callout-note-bg': '--slashmd-callout-note-bg',
  '--liminis-editor-callout-note-border': '--slashmd-callout-note-border',
  '--liminis-editor-callout-tip-bg': '--slashmd-callout-tip-bg',
  '--liminis-editor-callout-tip-border': '--slashmd-callout-tip-border',
  '--liminis-editor-callout-warning-bg': '--slashmd-callout-warning-bg',
  '--liminis-editor-callout-warning-border': '--slashmd-callout-warning-border',
  '--liminis-editor-checkbox-border': '--checkbox-border',
  '--liminis-editor-code-bg': '--vscode-code-bg',
  '--liminis-editor-errorForeground': '--vscode-errorForeground',
  '--liminis-editor-external-link': '--vscode-external-link',
  '--liminis-editor-focus-border': '--vscode-focus-border',
  '--liminis-editor-focusBorder': '--vscode-focusBorder',
  '--liminis-editor-font-family': '--vscode-font-family',
  '--liminis-editor-font-size': '--vscode-font-size',
  '--liminis-editor-foreground': '--vscode-foreground',
  '--liminis-editor-foreground-muted': '--vscode-foreground-muted',
  '--liminis-editor-h1-color': '--slashmd-h1-color',
  '--liminis-editor-h1-indent': '--slashmd-h1-indent',
  '--liminis-editor-h2-color': '--slashmd-h2-color',
  '--liminis-editor-h2-indent': '--slashmd-h2-indent',
  '--liminis-editor-h3-color': '--slashmd-h3-color',
  '--liminis-editor-h3-indent': '--slashmd-h3-indent',
  '--liminis-editor-h4-color': '--slashmd-h4-color',
  '--liminis-editor-h4-indent': '--slashmd-h4-indent',
  '--liminis-editor-h5-color': '--slashmd-h5-color',
  '--liminis-editor-h5-indent': '--slashmd-h5-indent',
  '--liminis-editor-input-bg': '--vscode-input-bg',
  '--liminis-editor-inputValidation-errorBackground': '--vscode-inputValidation-errorBackground',
  '--liminis-editor-italic-color': '--slashmd-italic-color',
  '--liminis-editor-link': '--vscode-link',
  '--liminis-editor-menu-background': '--vscode-menu-background',
  '--liminis-editor-menu-border': '--vscode-menu-border',
  '--liminis-editor-menu-foreground': '--vscode-menu-foreground',
  '--liminis-editor-menu-selectionBackground': '--vscode-menu-selectionBackground',
  '--liminis-editor-menu-separatorBackground': '--vscode-menu-separatorBackground',
  '--liminis-editor-notificationsInfoIcon-foreground': '--vscode-notificationsInfoIcon-foreground',
  '--liminis-editor-primary': '--editor-brand',
  '--liminis-editor-selection': '--vscode-selection',
  '--liminis-editor-token-comment': '--slashmd-token-comment',
  '--liminis-editor-token-function': '--slashmd-token-function',
  '--liminis-editor-token-keyword': '--slashmd-token-keyword',
  '--liminis-editor-token-operator': '--slashmd-token-operator',
  '--liminis-editor-token-property': '--slashmd-token-property',
  '--liminis-editor-token-punctuation': '--slashmd-token-punctuation',
  '--liminis-editor-token-selector': '--slashmd-token-selector',
  '--liminis-editor-token-variable': '--slashmd-token-variable',
  '--liminis-editor-toolbar-hoverBackground': '--vscode-toolbar-hoverBackground',
}

/**
 * Legacy name -> the `--liminis-editor-*` name it forwards to, post-ADR-98
 * inversion (#98). Every one of these 26 names is declared in `styles.css`'s
 * deprecated-shim block as a one-line `<legacy>: var(<target>);` — read by
 * nothing inside this package, kept only so a host still *reading* the
 * legacy name keeps getting a real value, via ordinary cascade resolution of
 * the shim's own `var()` reference. A host *setting* only the legacy name no
 * longer themes the package — nothing here consumes it — a documented,
 * accepted breaking change (see ADR-98, CHANGELOG's Unreleased). The 61
 * `--slashmd-*` names have no entry: #98 deletes them outright rather than
 * shimming them (verified unread by any known consumer of this package).
 */
export const LEGACY_SHIM_TARGET = {
  '--vscode-font-family': '--liminis-editor-font-family',
  '--vscode-font-size': '--liminis-editor-font-size',
  '--vscode-foreground': '--liminis-editor-foreground',
  '--vscode-background': '--liminis-editor-background',
  '--vscode-selection': '--liminis-editor-selection',
  '--vscode-border': '--liminis-editor-border',
  '--vscode-link': '--liminis-editor-link',
  '--vscode-external-link': '--liminis-editor-external-link',
  '--vscode-code-bg': '--liminis-editor-code-bg',
  '--checkbox-border': '--liminis-editor-checkbox-border',
  '--editor-brand': '--liminis-editor-primary',
  '--vscode-button-background': '--liminis-editor-button-background',
  '--vscode-button-foreground': '--liminis-editor-button-foreground',
  '--vscode-menu-background': '--liminis-editor-menu-background',
  '--vscode-menu-border': '--liminis-editor-menu-border',
  '--vscode-menu-foreground': '--liminis-editor-menu-foreground',
  '--vscode-menu-selectionBackground': '--liminis-editor-menu-selectionBackground',
  '--vscode-menu-separatorBackground': '--liminis-editor-menu-separatorBackground',
  '--vscode-toolbar-hoverBackground': '--liminis-editor-toolbar-hoverBackground',
  '--vscode-notificationsInfoIcon-foreground': '--liminis-editor-notificationsInfoIcon-foreground',
  '--vscode-inputValidation-errorBackground': '--liminis-editor-inputValidation-errorBackground',
  '--vscode-errorForeground': '--liminis-editor-errorForeground',
  '--vscode-focus-border': '--liminis-editor-focus-border',
  '--vscode-focusBorder': '--liminis-editor-focusBorder',
  '--vscode-input-bg': '--liminis-editor-input-bg',
  '--vscode-foreground-muted': '--liminis-editor-foreground-muted',
}

/**
 * True iff `legacyName` is declared in `strippedStylesCssText` (comment-
 * stripped, e.g. via `stripCssComments`) as a one-line shim forwarding to
 * `target` — `<legacyName>: var(<target>);` — with no fallback of its own.
 * This is the FR-002 invariant `LEGACY_SHIM_TARGET` records: a shim that
 * loses its `var()` forward (or gains a stray literal fallback, silently
 * reintroducing an independent legacy default) fails this check.
 */
export function resolvesToShimTarget(legacyName, target, strippedStylesCssText) {
  const re = new RegExp(`${legacyName}\\s*:\\s*var\\(\\s*${target}\\s*\\)\\s*;`)
  return re.test(strippedStylesCssText)
}

/**
 * Short, human-readable descriptions of what each token controls (FR-003).
 * Hand-curated — token names alone don't reliably convey purpose (compare
 * `--liminis-editor-focus-border` and `--liminis-editor-focusBorder`, two
 * distinct tokens used in different components) — but the set of *keys* is
 * verified against the generated inventory by `describe()` below and by the
 * drift-guard test, so a new token without a description fails CI rather
 * than silently shipping an empty "Controls" cell.
 */
const TOKEN_DESCRIPTIONS = {
  '--liminis-editor-background': 'Base background color of the editor surface and its popovers/menus.',
  '--liminis-editor-bold-color': 'Text color of bold (`**text**`) markdown spans.',
  '--liminis-editor-border': 'Default border color used throughout the editor chrome.',
  '--liminis-editor-button-background':
    'Background of primary action buttons (e.g. the correction panel\'s "Apply" button).',
  '--liminis-editor-button-foreground': 'Text color of primary action buttons.',
  '--liminis-editor-callout-caution-bg': 'Background of "caution" callout blocks.',
  '--liminis-editor-callout-caution-border': 'Left border accent of "caution" callout blocks.',
  '--liminis-editor-callout-important-bg': 'Background of "important" callout blocks.',
  '--liminis-editor-callout-important-border': 'Left border accent of "important" callout blocks.',
  '--liminis-editor-callout-note-bg': 'Background of "note" callout blocks.',
  '--liminis-editor-callout-note-border': 'Left border accent of "note" callout blocks.',
  '--liminis-editor-callout-tip-bg': 'Background of "tip" callout blocks.',
  '--liminis-editor-callout-tip-border': 'Left border accent of "tip" callout blocks.',
  '--liminis-editor-callout-warning-bg': 'Background of "warning" callout blocks.',
  '--liminis-editor-callout-warning-border': 'Left border accent of "warning" callout blocks.',
  '--liminis-editor-checkbox-border': 'Border color of unchecked task-list checkboxes.',
  '--liminis-editor-code-bg': 'Background of inline code spans and fenced code blocks.',
  '--liminis-editor-errorForeground': 'Text color for error and validation messages.',
  '--liminis-editor-external-link': 'Text color of links that point outside the document.',
  '--liminis-editor-focus-border': 'Border color of the toolbar link-input field when focused.',
  '--liminis-editor-focusBorder': 'Color of the drag-and-drop position indicator while reordering blocks.',
  '--liminis-editor-font-family': 'Base font family for the editor content.',
  '--liminis-editor-font-size': 'Base font size for the editor content.',
  '--liminis-editor-foreground': 'Default text color throughout the editor.',
  '--liminis-editor-foreground-muted': 'Hover border color for the frontmatter tray\'s raw-view toggle.',
  '--liminis-editor-h1-color': 'Text color of level-1 (`#`) headings.',
  '--liminis-editor-h1-indent': 'Left margin of level-1 (`#`) headings.',
  '--liminis-editor-h2-color': 'Text color of level-2 (`##`) headings.',
  '--liminis-editor-h2-indent': 'Left margin of level-2 (`##`) headings.',
  '--liminis-editor-h3-color': 'Text color of level-3 (`###`) headings.',
  '--liminis-editor-h3-indent': 'Left margin of level-3 (`###`) headings.',
  '--liminis-editor-h4-color': 'Text color of level-4 (`####`) headings.',
  '--liminis-editor-h4-indent': 'Left margin of level-4 (`####`) headings.',
  '--liminis-editor-h5-color': 'Text color of level-5 (`#####`) headings.',
  '--liminis-editor-h5-indent': 'Left margin of level-5 (`#####`) headings.',
  '--liminis-editor-input-bg': 'Background of the toolbar link-input field.',
  '--liminis-editor-inputValidation-errorBackground': 'Background of inline validation-error messages.',
  '--liminis-editor-italic-color': 'Text color of italic (`*text*`) markdown spans.',
  '--liminis-editor-link': 'Text color of in-document links.',
  '--liminis-editor-menu-background': 'Background of context menus (block, selection and correction menus).',
  '--liminis-editor-menu-border': 'Border color of context menus.',
  '--liminis-editor-menu-foreground': 'Text color of context menu items.',
  '--liminis-editor-menu-selectionBackground': 'Background of a hovered/selected context menu item.',
  '--liminis-editor-menu-separatorBackground': 'Color of separator lines inside context menus.',
  '--liminis-editor-muted-100': 'Background of the C4 diagram layout-toggle buttons when inactive.',
  '--liminis-editor-muted-foreground': 'Icon/text color of the C4 diagram layout-toggle buttons when inactive.',
  '--liminis-editor-notificationsInfoIcon-foreground': 'Color of informational icons in inline notifications.',
  '--liminis-editor-primary': 'Icon/text color of the C4 diagram layout-toggle buttons when active.',
  '--liminis-editor-primary-100': 'Background of the C4 diagram layout-toggle buttons when active.',
  '--liminis-editor-selection': 'Background color of selected/highlighted text.',
  '--liminis-editor-token-comment': 'Syntax-highlight color for comments in fenced code blocks.',
  '--liminis-editor-token-function': 'Syntax-highlight color for function names in fenced code blocks.',
  '--liminis-editor-token-keyword': 'Syntax-highlight color for keywords in fenced code blocks.',
  '--liminis-editor-token-operator': 'Syntax-highlight color for operators in fenced code blocks.',
  '--liminis-editor-token-property': 'Syntax-highlight color for object properties in fenced code blocks.',
  '--liminis-editor-token-punctuation': 'Syntax-highlight color for punctuation in fenced code blocks.',
  '--liminis-editor-token-selector': 'Syntax-highlight color for CSS selectors in fenced code blocks.',
  '--liminis-editor-token-variable': 'Syntax-highlight color for variables in fenced code blocks.',
  '--liminis-editor-toolbar-hoverBackground': 'Background of a toolbar button on hover.',
}

/**
 * Short, human-readable description of what `name` controls (FR-003).
 * Returns `undefined` for a token with no curated entry — callers decide
 * whether that's an error (the drift guard does; `renderTokenTable` renders
 * a visible placeholder rather than silently omitting the column).
 */
export function describe(name) {
  return TOKEN_DESCRIPTIONS[name]
}

const STRUCTURAL_KEYWORDS = [
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'padding',
  'width',
  'height',
  'gap',
  'line-height',
  'font-family',
  'font-size',
]
const COSMETIC_KEYWORDS = [
  'color',
  'background',
  'background-color',
  'border-color',
  'border-left-color',
  'border-top-color',
  'border-bottom-color',
  'border-right-color',
  'fill',
  'stroke',
  'outline',
]

/**
 * Structural (affects layout) vs. cosmetic (affects appearance only),
 * inferred from the CSS property each token's consumption sites set. Tokens
 * reached only through JS-variable indirection (no direct `property: var(...)`
 * line) carry no property hints and default to cosmetic — true of every
 * such token in this codebase today (all are colors/backgrounds), including
 * ones set via a CSS shorthand like `border: 1px solid var(--x)`, where the
 * property name alone (`border`) is not decisive on its own.
 */
export function classify(name, properties) {
  const props = properties ?? new Set()
  for (const property of props) {
    if (STRUCTURAL_KEYWORDS.includes(property)) return 'structural'
  }
  for (const property of props) {
    if (COSMETIC_KEYWORDS.includes(property)) return 'cosmetic'
  }
  return 'cosmetic'
}

/**
 * Build the full inventory: one row per consumed token, sorted by name.
 * `srcRoot` and `stylesCssPath` point at either the real repo or a fixture.
 */
export function buildInventory(srcRoot, stylesCssPath) {
  const consumed = consumedTokens(srcRoot)
  const defaulted = defaultedTokens(stylesCssPath)

  return [...consumed.keys()]
    .sort()
    .map((name) => ({
      name,
      resolves: resolvesWithoutHost(name, consumed, defaulted),
      hasDefault: defaulted.has(name),
      classification: classify(name, consumed.get(name).properties),
      description: describe(name),
      previousName: PREVIOUS_NAME[name] ?? null,
    }))
}

const CLASSIFICATION_LABEL = { structural: 'Structural', cosmetic: 'Cosmetic' }

/**
 * Render the inventory as a GitHub-flavored markdown table, including the
 * `PREVIOUS_NAME` a renamed (#51) token replaced — so a reader migrating an
 * old override can find its `--liminis-editor-*` equivalent directly in this
 * table rather than needing to guess at (or be pointed elsewhere for) the
 * prefix-stripping convention, which isn't 1:1 for every token (see the
 * `--checkbox-border`/`--vscode-border` collision in `PREVIOUS_NAME`'s docs).
 */
export function renderTokenTable(inventory) {
  const header =
    '| Custom property | Previous name | Controls | Kind | Has a default |\n| --- | --- | --- | --- | --- |'
  const rows = inventory.map(
    (row) =>
      `| \`${row.name}\` | ${row.previousName ? `\`${row.previousName}\`` : '—'} | ${row.description ?? '_undocumented — add an entry to TOKEN_DESCRIPTIONS_'} | ${CLASSIFICATION_LABEL[row.classification]} | ${row.hasDefault ? 'Yes' : 'No (inline fallback only)'} |`,
  )
  return [header, ...rows].join('\n')
}

/** Parse a rendered token table back into the set of documented names. */
export function parseDocumentedTokens(markdownBlock) {
  const re = /^\|\s*`(--[a-zA-Z0-9-]+)`\s*\|/gm
  const names = new Set()
  let match
  while ((match = re.exec(markdownBlock))) {
    names.add(match[1])
  }
  return names
}

/**
 * Compare the live "defined" set (verveguy/liminis-editor#79) against a
 * checked-in baseline of previously-defined token names, by identity — not
 * by count. `missing` is every baselined name no longer in `current`
 * (`scripts/lib/theming-defined-tokens-baseline.json` says a host could once
 * read this token; `styles.css` no longer declares it — the silent-drop
 * failure mode this issue exists to catch). `added` is every current name
 * not yet in the baseline (a legitimate new definition, never itself a
 * reason to fail — see FR-006). Both are sorted for a stable, readable diff.
 *
 * A same-count rename (one name removed, a different name added) shows up
 * as one entry in each array, not a net-zero no-op — this is deliberate:
 * comparing by identity is exactly what lets this guard catch the #51
 * scenario a naive count comparison would have missed.
 */
export function diffDefinedTokenBaseline(current, baseline) {
  const currentSet = current instanceof Set ? current : new Set(current)
  const baselineSet = baseline instanceof Set ? baseline : new Set(baseline)
  const missing = [...baselineSet].filter((name) => !currentSet.has(name)).sort()
  const added = [...currentSet].filter((name) => !baselineSet.has(name)).sort()
  return { missing, added }
}

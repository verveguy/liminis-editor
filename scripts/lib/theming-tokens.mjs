#!/usr/bin/env node
/**
 * Shared extraction logic for the theming-contract inventory (verveguy/liminis-editor#50).
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
 * Every `var(--token` consumption site found in `text`, comment-stripped
 * first. A site is `{ name, hasFallback }` — `hasFallback` is true iff the
 * token name is immediately followed by a comma, which is all that's needed
 * to know a fallback value is present; the fallback expression itself
 * (which may itself contain nested `var(...)` or `rgba(...)`) is never
 * parsed.
 */
function consumptionSitesIn(text) {
  const re = new RegExp(`var\\(\\s*(${TOKEN_RE})\\s*(,)?`, 'g')
  const sites = []
  let match
  while ((match = re.exec(text))) {
    sites.push({ name: match[1], hasFallback: Boolean(match[2]) })
  }
  return sites
}

/**
 * A CSS property name immediately preceding a `var(--token` reference on the
 * same source line, e.g. `color` in `color: var(--vscode-foreground);`.
 * Returns `null` when the token is reached indirectly (assigned to a JS
 * variable first, then interpolated elsewhere) — classification treats that
 * as "no signal" rather than guessing.
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
 * Scan `srcRoot` for every custom property `var(--...)` consumes.
 * Returns a `Map<name, { files: Set<string>, sites: Array<{file, hasFallback}>, properties: Set<string> }>`.
 */
export function consumedTokens(srcRoot) {
  const cssFiles = listFiles(srcRoot, CSS_EXTENSIONS)
  const jsFiles = listFiles(srcRoot, JS_EXTENSIONS)
  const tokens = new Map()

  const record = (file, stripped) => {
    for (const site of consumptionSitesIn(stripped)) {
      if (!tokens.has(site.name)) {
        tokens.set(site.name, { files: new Set(), sites: [], properties: new Set() })
      }
      const entry = tokens.get(site.name)
      entry.files.add(file)
      entry.sites.push({ file, hasFallback: site.hasFallback })
    }
    const hints = propertyHintsIn(stripped)
    for (const [name, properties] of hints) {
      if (!tokens.has(name)) {
        tokens.set(name, { files: new Set(), sites: [], properties: new Set() })
      }
      for (const property of properties) tokens.get(name).properties.add(property)
    }
  }

  for (const file of cssFiles) {
    record(file, stripCssComments(readFileSync(file, 'utf-8')))
  }
  for (const file of jsFiles) {
    record(file, stripJsComments(readFileSync(file, 'utf-8')))
  }

  return tokens
}

/**
 * Every custom property declared (not consumed) anywhere in `stylesCssPath`,
 * comment-stripped. A declaration is `--name:` — deliberately not restricted
 * to `:root`/`.dark`, since the `@media print` block also declares a subset
 * and this repo's "defined in styles.css" count is a flat "declared
 * anywhere" count.
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
 * Short, human-readable descriptions of what each token controls (FR-003).
 * Hand-curated — token names alone don't reliably convey purpose (compare
 * `--vscode-focus-border` and `--vscode-focusBorder`, two distinct tokens
 * used in different components) — but the set of *keys* is verified against
 * the generated inventory by `describe()` below and by the drift-guard test,
 * so a new token without a description fails CI rather than silently
 * shipping an empty "Controls" cell.
 */
const TOKEN_DESCRIPTIONS = {
  '--checkbox-border': 'Border color of unchecked task-list checkboxes.',
  '--color-muted-100': 'Background of the C4 diagram layout-toggle buttons when inactive.',
  '--color-muted-foreground': 'Icon/text color of the C4 diagram layout-toggle buttons when inactive.',
  '--color-primary': 'Icon/text color of the C4 diagram layout-toggle buttons when active.',
  '--color-primary-100': 'Background of the C4 diagram layout-toggle buttons when active.',
  '--slashmd-bold-color': 'Text color of bold (`**text**`) markdown spans.',
  '--slashmd-callout-caution-bg': 'Background of "caution" callout blocks.',
  '--slashmd-callout-caution-border': 'Left border accent of "caution" callout blocks.',
  '--slashmd-callout-important-bg': 'Background of "important" callout blocks.',
  '--slashmd-callout-important-border': 'Left border accent of "important" callout blocks.',
  '--slashmd-callout-note-bg': 'Background of "note" callout blocks.',
  '--slashmd-callout-note-border': 'Left border accent of "note" callout blocks.',
  '--slashmd-callout-tip-bg': 'Background of "tip" callout blocks.',
  '--slashmd-callout-tip-border': 'Left border accent of "tip" callout blocks.',
  '--slashmd-callout-warning-bg': 'Background of "warning" callout blocks.',
  '--slashmd-callout-warning-border': 'Left border accent of "warning" callout blocks.',
  '--slashmd-h1-color': 'Text color of level-1 (`#`) headings.',
  '--slashmd-h1-indent': 'Left margin of level-1 (`#`) headings.',
  '--slashmd-h2-color': 'Text color of level-2 (`##`) headings.',
  '--slashmd-h2-indent': 'Left margin of level-2 (`##`) headings.',
  '--slashmd-h3-color': 'Text color of level-3 (`###`) headings.',
  '--slashmd-h3-indent': 'Left margin of level-3 (`###`) headings.',
  '--slashmd-h4-color': 'Text color of level-4 (`####`) headings.',
  '--slashmd-h4-indent': 'Left margin of level-4 (`####`) headings.',
  '--slashmd-h5-color': 'Text color of level-5 (`#####`) headings.',
  '--slashmd-h5-indent': 'Left margin of level-5 (`#####`) headings.',
  '--slashmd-italic-color': 'Text color of italic (`*text*`) markdown spans.',
  '--slashmd-token-comment': 'Syntax-highlight color for comments in fenced code blocks.',
  '--slashmd-token-function': 'Syntax-highlight color for function names in fenced code blocks.',
  '--slashmd-token-keyword': 'Syntax-highlight color for keywords in fenced code blocks.',
  '--slashmd-token-operator': 'Syntax-highlight color for operators in fenced code blocks.',
  '--slashmd-token-property': 'Syntax-highlight color for object properties in fenced code blocks.',
  '--slashmd-token-punctuation': 'Syntax-highlight color for punctuation in fenced code blocks.',
  '--slashmd-token-selector': 'Syntax-highlight color for CSS selectors in fenced code blocks.',
  '--slashmd-token-variable': 'Syntax-highlight color for variables in fenced code blocks.',
  '--vscode-background': 'Base background color of the editor surface and its popovers/menus.',
  '--vscode-border': 'Default border color used throughout the editor chrome.',
  '--vscode-button-background': 'Background of primary action buttons (e.g. the correction panel\'s "Apply" button).',
  '--vscode-button-foreground': 'Text color of primary action buttons.',
  '--vscode-code-bg': 'Background of inline code spans and fenced code blocks.',
  '--vscode-errorForeground': 'Text color for error and validation messages.',
  '--vscode-external-link': 'Text color of links that point outside the document.',
  '--vscode-focus-border': 'Border color of the toolbar link-input field when focused.',
  '--vscode-focusBorder': 'Color of the drag-and-drop position indicator while reordering blocks.',
  '--vscode-font-family': 'Base font family for the editor content.',
  '--vscode-font-size': 'Base font size for the editor content.',
  '--vscode-foreground': 'Default text color throughout the editor.',
  '--vscode-foreground-muted': 'Hover border color for the frontmatter tray\'s raw-view toggle.',
  '--vscode-input-bg': 'Background of the toolbar link-input field.',
  '--vscode-inputValidation-errorBackground': 'Background of inline validation-error messages.',
  '--vscode-link': 'Text color of in-document links.',
  '--vscode-menu-background': 'Background of context menus (block, selection and correction menus).',
  '--vscode-menu-border': 'Border color of context menus.',
  '--vscode-menu-foreground': 'Text color of context menu items.',
  '--vscode-menu-selectionBackground': 'Background of a hovered/selected context menu item.',
  '--vscode-menu-separatorBackground': 'Color of separator lines inside context menus.',
  '--vscode-notificationsInfoIcon-foreground': 'Color of informational icons in inline notifications.',
  '--vscode-selection': 'Background color of selected/highlighted text.',
  '--vscode-toolbar-hoverBackground': 'Background of a toolbar button on hover.',
};

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
    }))
}

const CLASSIFICATION_LABEL = { structural: 'Structural', cosmetic: 'Cosmetic' }

/** Render the inventory as a GitHub-flavored markdown table. */
export function renderTokenTable(inventory) {
  const header =
    '| Custom property | Controls | Kind | Has a default |\n| --- | --- | --- | --- |'
  const rows = inventory.map(
    (row) =>
      `| \`${row.name}\` | ${row.description ?? '_undocumented — add an entry to TOKEN_DESCRIPTIONS_'} | ${CLASSIFICATION_LABEL[row.classification]} | ${row.hasDefault ? 'Yes' : 'No (inline fallback only)'} |`,
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

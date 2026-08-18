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

  const record = (file, text, stripped) => {
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
    const text = readFileSync(file, 'utf-8')
    record(file, text, stripCssComments(text))
  }
  for (const file of jsFiles) {
    const text = readFileSync(file, 'utf-8')
    record(file, text, stripJsComments(text))
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
    }))
}

const CLASSIFICATION_LABEL = { structural: 'Structural', cosmetic: 'Cosmetic' }

/** Render the inventory as a GitHub-flavored markdown table. */
export function renderTokenTable(inventory) {
  const header = '| Custom property | Kind | Has a default |\n| --- | --- | --- |'
  const rows = inventory.map(
    (row) =>
      `| \`${row.name}\` | ${CLASSIFICATION_LABEL[row.classification]} | ${row.hasDefault ? 'Yes' : 'No (inline fallback only)'} |`,
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

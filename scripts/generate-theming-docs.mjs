#!/usr/bin/env node
/**
 * Regenerate the CSS custom-property table in `README.md` between the
 * `theming-tokens` markers, from the token inventory `scripts/lib/theming-tokens.mjs`
 * extracts out of `src/`.
 *
 * The table is generated, not hand-maintained (verveguy/liminis-editor#50) —
 * `tests/theming-contract.test.ts` fails CI if this script has not been run
 * after a `var(--x)` is added to or removed from `src/`.
 *
 * Usage: `node scripts/generate-theming-docs.mjs`
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInventory, renderTokenTable } from './lib/theming-tokens.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README_PATH = resolve(REPO_ROOT, 'README.md')
const SRC_ROOT = resolve(REPO_ROOT, 'src')
const STYLES_CSS_PATH = resolve(REPO_ROOT, 'src', 'styles.css')

const START_MARKER = '<!-- theming-tokens:start -->'
const END_MARKER = '<!-- theming-tokens:end -->'

export function renderThemingBlock() {
  const inventory = buildInventory(SRC_ROOT, STYLES_CSS_PATH)
  return `${START_MARKER}\n${renderTokenTable(inventory)}\n${END_MARKER}`
}

export function withThemingBlock(readme, block) {
  const startIndex = readme.indexOf(START_MARKER)
  const endIndex = readme.indexOf(END_MARKER)
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`README.md is missing the ${START_MARKER} / ${END_MARKER} markers`)
  }
  return readme.slice(0, startIndex) + block + readme.slice(endIndex + END_MARKER.length)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const readme = readFileSync(README_PATH, 'utf-8')
  const updated = withThemingBlock(readme, renderThemingBlock())
  writeFileSync(README_PATH, updated)
  console.log(`Regenerated the theming token table in ${README_PATH}`)
}

#!/usr/bin/env node
/**
 * Regenerate `scripts/lib/theming-defined-tokens-baseline.json`, the
 * checked-in record `tests/theming-contract.test.ts` diffs the live
 * "defined" set against (verveguy/liminis-editor#79).
 *
 * Unlike the README's token table (`generate-theming-docs.mjs`), this
 * baseline is not regenerated automatically as part of CI — updating it is
 * a deliberate act that distinguishes an intentional rename/removal from an
 * accidental one. Run this after knowingly renaming, removing or adding a
 * `styles.css` definition.
 *
 * Usage: `node scripts/update-theming-baseline.mjs`
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultedTokens } from './lib/theming-tokens.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STYLES_CSS_PATH = resolve(REPO_ROOT, 'src', 'styles.css')
const BASELINE_PATH = resolve(REPO_ROOT, 'scripts', 'lib', 'theming-defined-tokens-baseline.json')

export function renderBaseline(stylesCssPath) {
  const names = [...defaultedTokens(stylesCssPath)].sort()
  return `${JSON.stringify(names, null, 2)}\n`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(BASELINE_PATH, renderBaseline(STYLES_CSS_PATH))
  console.log(`Regenerated the defined-token baseline at ${BASELINE_PATH}`)
}

#!/usr/bin/env node
/**
 * Copy non-TypeScript assets into `dist/`.
 *
 * `tsc` emits only what it compiles, so `src/styles.css` — the sheet the
 * `./styles.css` subpath resolves to, and the one ADR-077 requires a host to
 * import for annotation markers to be visible — has to be placed by hand.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const ASSETS = [
  'styles.css',
  // The vendored third-party code ships in `dist/`, so its license and
  // provenance notice must ship alongside it.
  'markdown/vendor/mdast-util-wiki-link/LICENSE',
  'markdown/vendor/mdast-util-wiki-link/README.md',
]

for (const asset of ASSETS) {
  const from = join(packageRoot, 'src', asset)
  const to = join(packageRoot, 'dist', asset)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`copied src/${asset} -> dist/${asset}`)
}

#!/usr/bin/env node
/**
 * Build the public GitHub Pages site (verveguy/liminis-editor#3): a
 * release-triggered build of `examples/demo`, which *is* the site rather
 * than a separate app wrapping it (docs/decisions/adr-082.md).
 *
 * Demo-only, unlike `scripts/build-examples.mjs` — a Pages deploy has no use
 * for `examples/electron`, and building it on every release would just add
 * time and failure surface unrelated to the site.
 *
 * `VITE_LIMINIS_EDITOR_VERSION` and `VITE_BASE_PATH`, if set in the calling
 * environment, are picked up by `examples/demo/vite.config.js` and
 * `App.jsx` automatically — this script does not need to forward them
 * itself, since `run()` inherits `process.env` for the `vite build` it
 * invokes.
 *
 * Usage: `pnpm build:site` (or `node scripts/build-site.mjs`).
 * Output: `examples/demo/dist`.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAndPackPackage, installTarballIntoShell, run } from './lib/install-tarball.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = REPO_ROOT
const DEMO_DIR = join(REPO_ROOT, 'examples', 'demo')

const tarball = buildAndPackPackage(PACKAGE_DIR, REPO_ROOT, 'liminis-editor-site-')

console.log('▶ Generating demo fixture data from the round-trip corpus')
run('node', ['scripts/generate-demo-fixtures.mjs'], REPO_ROOT)

console.log('▶ Generating demo documentation content from README.md')
run('node', ['scripts/generate-demo-docs.mjs'], REPO_ROOT)

console.log('▶ Installing the tarball into examples/demo')
installTarballIntoShell(DEMO_DIR, tarball)

console.log('▶ Building examples/demo')
run('pnpm', ['run', 'build'], DEMO_DIR)

console.log(`\nSite built at ${join('examples', 'demo', 'dist')}`)

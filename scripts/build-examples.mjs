#!/usr/bin/env node
/**
 * Build `@liminis/editor` and pack it once, then build both example shells
 * (`examples/demo`, `examples/electron`) against the packed tarball
 * (verveguy/liminis-editor#2, FR-009).
 *
 * Each shell installs the tarball with `--ignore-workspace`, the same
 * pattern `scripts/run-demo.mjs` and `scripts/verify-package.mjs` already
 * use for their own single consumer — generalized here to more than one,
 * from one pack, so CI pays the build+pack cost once rather than per shell.
 *
 * `examples/demo`'s content is generated from the round-trip fixture corpus
 * before its build runs (docs/decisions/adr-081.md); `examples/electron` has
 * no such step.
 *
 * Usage: `pnpm build:examples` (or `node scripts/build-examples.mjs`).
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAndPackPackage, installTarballIntoShell, run } from './lib/install-tarball.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = REPO_ROOT

const SHELLS = [
  { name: 'demo', dir: join(REPO_ROOT, 'examples', 'demo') },
  { name: 'electron', dir: join(REPO_ROOT, 'examples', 'electron') },
]

const tarball = buildAndPackPackage(PACKAGE_DIR, REPO_ROOT, 'liminis-editor-examples-')

console.log('▶ Generating demo fixture data from the round-trip corpus')
run('node', ['scripts/generate-demo-fixtures.mjs'], REPO_ROOT)

for (const { name, dir } of SHELLS) {
  console.log(`\n▶ Installing the tarball into examples/${name}`)
  installTarballIntoShell(dir, tarball)

  console.log(`▶ Building examples/${name}`)
  run('pnpm', ['run', 'build'], dir)
}

console.log('\nBoth example shells built successfully.')

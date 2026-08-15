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
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = REPO_ROOT

const SHELLS = [
  { name: 'demo', dir: join(REPO_ROOT, 'examples', 'demo') },
  { name: 'electron', dir: join(REPO_ROOT, 'examples', 'electron') },
]

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
}

console.log('▶ Building @liminis/editor')
run('pnpm', ['run', 'build'], PACKAGE_DIR)

console.log('▶ Packing the tarball')
const packDir = mkdtempSync(join(tmpdir(), 'liminis-editor-examples-'))
process.on('exit', () => rmSync(packDir, { recursive: true, force: true }))
const tarball = run('pnpm', ['pack', '--pack-destination', packDir], PACKAGE_DIR).trim().split('\n').pop().trim()
if (!existsSync(tarball)) {
  console.error(`could not find the packed tarball (parsed: ${tarball})`)
  process.exit(1)
}
console.log(`  ${relative(REPO_ROOT, tarball) || tarball}`)

console.log('▶ Generating demo fixture data from the round-trip corpus')
run('node', ['scripts/generate-demo-fixtures.mjs'], REPO_ROOT)

for (const { name, dir } of SHELLS) {
  console.log(`\n▶ Installing the tarball into examples/${name}`)

  // `pnpm add` writes the tarball's absolute temp path into the manifest.
  // The install is what we want; the edit is not — snapshot and restore,
  // exactly as run-demo.mjs and verify-package.mjs do for their own fixture.
  const manifestPath = join(dir, 'package.json')
  const manifest = readFileSync(manifestPath, 'utf8')
  const lockPath = join(dir, 'pnpm-lock.yaml')
  const hadLock = existsSync(lockPath)
  const lock = hadLock ? readFileSync(lockPath, 'utf8') : null
  try {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    rmSync(lockPath, { force: true })
    run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], dir)
    run('pnpm', ['add', '--ignore-workspace', tarball], dir)
  } finally {
    writeFileSync(manifestPath, manifest)
    if (hadLock) writeFileSync(lockPath, lock)
    else rmSync(lockPath, { force: true })
  }

  console.log(`▶ Building examples/${name}`)
  run('pnpm', ['run', 'build'], dir)
}

console.log('\nBoth example shells built successfully.')

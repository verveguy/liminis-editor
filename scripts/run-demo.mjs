#!/usr/bin/env node
/**
 * Build and pack `@liminis/editor`, install the tarball into `examples/demo`,
 * and start the demo (#940 / FR-008, SC-006).
 *
 * The demo installs the *packed tarball*, not the workspace path, and with
 * `--ignore-workspace` so pnpm cannot quietly substitute a symlink. That is
 * what keeps it honest: it exercises the same artifact an external adopter
 * would install, through the same `exports` map, so it cannot drift into a
 * privileged second consumer that keeps working after a real one breaks.
 *
 * Usage: `pnpm demo` from the repository root.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'editor')
const DEMO_DIR = join(REPO_ROOT, 'examples', 'demo')

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

console.log('▶ Building @liminis/editor')
run('pnpm', ['--filter', '@liminis/editor', 'run', 'build'], REPO_ROOT)

console.log('▶ Packing the tarball')
const packDir = mkdtempSync(join(tmpdir(), 'liminis-editor-demo-'))
const tarball = run('pnpm', ['pack', '--pack-destination', packDir], PACKAGE_DIR).trim().split('\n').pop().trim()
if (!existsSync(tarball)) {
  console.error(`could not find the packed tarball (parsed: ${tarball})`)
  process.exit(1)
}

console.log('▶ Installing it into examples/demo')
// `pnpm add` writes the tarball's absolute temp path into the manifest as a
// `file:` specifier. The install is what we want; the edit is not. The temp
// directory is deleted when this script exits, so leaving the edit in place
// would both dirty the working tree with a machine-specific path and break the
// *next* run — `pnpm install` would try to resolve a tarball that no longer
// exists, before `pnpm add` ever got the chance to replace it. Snapshot and
// restore, exactly as `scripts/verify-package.mjs` does for its own fixture.
const demoManifestPath = join(DEMO_DIR, 'package.json')
const demoManifest = readFileSync(demoManifestPath, 'utf8')
try {
  rmSync(join(DEMO_DIR, 'node_modules'), { recursive: true, force: true })
  rmSync(join(DEMO_DIR, 'pnpm-lock.yaml'), { force: true })
  run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], DEMO_DIR)
  run('pnpm', ['add', '--ignore-workspace', tarball], DEMO_DIR)
} finally {
  writeFileSync(demoManifestPath, demoManifest)
}

console.log('▶ Starting the demo — http://localhost:5178\n')
const dev = spawnSync('pnpm', ['run', 'dev'], { cwd: DEMO_DIR, stdio: 'inherit' })
rmSync(packDir, { recursive: true, force: true })
process.exit(dev.status ?? 0)

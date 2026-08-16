/**
 * Shared build/pack/install orchestration for scripts that need to run an
 * example shell against the packed `@liminis/editor` tarball, the same way a
 * real external adopter would install it.
 *
 * Extracted from `scripts/build-examples.mjs`, which had this logic once for
 * two shells; `scripts/build-site.mjs` (verveguy/liminis-editor#3) is a third
 * caller with a single shell, and a third copy of the manifest/lockfile
 * snapshot-restore dance was worse than one shared implementation.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

export function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
}

/**
 * Builds `@liminis/editor` and packs it to a temp directory (removed on
 * process exit). Returns the absolute path of the packed tarball.
 */
export function buildAndPackPackage(packageDir, repoRoot, tmpPrefix) {
  console.log('▶ Building @liminis/editor')
  run('pnpm', ['run', 'build'], packageDir)

  console.log('▶ Packing the tarball')
  const packDir = mkdtempSync(join(tmpdir(), tmpPrefix))
  process.on('exit', () => rmSync(packDir, { recursive: true, force: true }))
  const tarball = run('pnpm', ['pack', '--pack-destination', packDir], packageDir).trim().split('\n').pop().trim()
  if (!existsSync(tarball)) {
    console.error(`could not find the packed tarball (parsed: ${tarball})`)
    process.exit(1)
  }
  console.log(`  ${relative(repoRoot, tarball) || tarball}`)
  return tarball
}

/**
 * Installs a packed tarball into an example shell directory with
 * `--ignore-workspace`, restoring the shell's own `package.json` and
 * `pnpm-lock.yaml` afterwards.
 *
 * `pnpm add` writes the tarball's absolute temp path into the manifest as a
 * `file:` specifier. The install is what's wanted; the edit is not — it would
 * both dirty the working tree with a machine-specific path and break the
 * *next* run, since the temp directory is deleted on exit.
 */
export function installTarballIntoShell(dir, tarball) {
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
}

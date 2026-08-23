#!/usr/bin/env node
/**
 * Build the demo and stage it at site/public/demo, where Astro copies it into
 * the site output.
 *
 * The demo used to *be* the site, served from the Pages root. It is now one
 * page of a documentation site, at /demo/, and the docs are what a reader
 * arrives at. Everything about how it is built is unchanged: scripts/
 * build-site.mjs packs the local package and installs that tarball into
 * examples/demo, so the demo exercises the real artifact rather than the source
 * tree (docs/decisions/adr-082.md).
 *
 * The same command runs locally and in CI. The staged copy is gitignored, so a
 * fresh checkout running `pnpm dev` would otherwise serve a 404 for the /demo/
 * link the homepage carries:
 *
 *     pnpm --dir site demo && pnpm --dir site dev
 */

import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SITE)
const BUILT = join(REPO, 'examples/demo/dist')
const TARGET = join(SITE, 'public/demo')

// The demo is served from a subpath of a site that is itself served from a
// subpath, so its base is the two joined. Vite needs the trailing slash.
const base = process.env.VITE_BASE_PATH ?? '/liminis-editor/'
const demoBase = `${base.endsWith('/') ? base : `${base}/`}demo/`

execFileSync('pnpm', ['run', 'build:site'], {
  cwd: REPO,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: demoBase },
})

rmSync(TARGET, { recursive: true, force: true })
mkdirSync(dirname(TARGET), { recursive: true })
cpSync(BUILT, TARGET, { recursive: true })

console.log(`Demo staged at ${TARGET} — it will be served at ${demoBase}`)

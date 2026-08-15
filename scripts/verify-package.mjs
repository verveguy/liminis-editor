#!/usr/bin/env node
/**
 * Prove `@liminis/editor` is publishable, and keep it that way.
 *
 * Build → pack → install the tarball into an external-style consumer *outside*
 * the pnpm workspace → type-check it under two module-resolution modes → build
 * three measurement arms → assert the entry-graph boundaries the seven subpaths
 * exist to keep.
 *
 * Why a script rather than assertions in the unit suite: the unit suite reads
 * source and config *text*, deliberately, because the unit-test CI job never
 * runs a build. Everything here needs a real built artifact, so it runs in its
 * own job.
 *
 * Originally verveguy/liminis#940; see `docs/provenance.md` for how bare
 * `FR-NNN`/`SC-NNN`/`#NNN` references in this repository resolve.
 *
 * Usage: `pnpm verify:package` (or `node scripts/verify-package.mjs`).
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The package is the repository root here, so `REPO_ROOT` and `PACKAGE_DIR` are
// the same directory. They are kept as separate names because the distinction is
// real — `CONSUMER_DIR` hangs off the repository, not off the package — and
// because collapsing them would make every path below read as though it were
// relative to the package's own `src/`.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_DIR = REPO_ROOT
const CONSUMER_DIR = join(REPO_ROOT, 'examples', 'external-consumer')

const ARMS = ['markdown-only', 'annotations-off', 'annotations-on']

let failures = 0

function step(message) {
  console.log(`\n[1m▶ ${message}[0m`)
}

function check(name, ok, detail) {
  if (ok) {
    console.log(`  [32m✓[0m ${name}`)
  } else {
    failures += 1
    console.log(`  [31m✗[0m ${name}`)
    if (detail) console.log(`      ${detail}`)
  }
}

// Temp directories are registered here rather than removed inline at the end of
// the happy path. Any `run()` below can throw — a failing install, a failing
// arm build — and an un-caught throw would otherwise leak a `mkdtemp` directory
// per failed run, which is exactly the state CI is in when you most want to run
// this repeatedly.
const tempDirs = []
process.on('exit', () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function run(command, args, cwd, env = {}) {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

// ---------------------------------------------------------------------------
// 1. Build and pack
// ---------------------------------------------------------------------------

step('Building @liminis/editor')
run('pnpm', ['run', 'build'], PACKAGE_DIR)

step('Packing the tarball')
const packDir = tempDir('liminis-editor-pack-')
const packOutput = run('pnpm', ['pack', '--pack-destination', packDir], PACKAGE_DIR)
const tarball = packOutput.trim().split('\n').pop().trim()
if (!existsSync(tarball)) {
  console.error(`could not find the packed tarball (parsed: ${tarball})`)
  process.exit(1)
}
console.log(`  ${relative(REPO_ROOT, tarball) || tarball}`)

// The packed manifest is what an external consumer actually resolves through.
// The checked-in one still points at `src/`, so that in-workspace consumers keep
// resolving raw TypeScript (which is what makes a Tailwind `@source` directive
// and a bundler's externalization exclusion able to name real files) —
// `publishConfig` is what swaps them to `dist/` at pack time.
step('Checking the packed manifest')
const extractDir = tempDir('liminis-editor-extract-')
run('tar', ['xzf', tarball, '-C', extractDir], REPO_ROOT)
const packed = JSON.parse(readFileSync(join(extractDir, 'package', 'package.json'), 'utf8'))

check('main points at dist/', packed.main === './dist/index.js', `got ${packed.main}`)
check('types points at dist/', packed.types === './dist/index.d.ts', `got ${packed.types}`)

const EXPECTED_SUBPATHS = ['.', './markdown', './annotations', './headless', './contract', './nodes', './styles.css']
for (const subpath of EXPECTED_SUBPATHS) {
  const entry = packed.exports?.[subpath]
  const target = typeof entry === 'string' ? entry : entry?.default
  check(
    `exports "${subpath}" resolves into dist/`,
    typeof target === 'string' && target.startsWith('./dist/'),
    `got ${JSON.stringify(entry)}`,
  )
  if (target) {
    check(
      `exports "${subpath}" target exists in the tarball`,
      existsSync(join(extractDir, 'package', target)),
      `missing ${target}`,
    )
  }
}

// FR-003. Asserted here on the *packed* manifest, not just in
// `editor-package-wiring.test.ts`, which reads the checked-in one — `publishConfig`
// can override `dependencies`/`peerDependencies` too, so the source manifest being
// right does not by itself mean the shipped artifact is. The named four are the
// floor; the sweep below is what actually covers the set, so adding a twelfth
// `@lexical/*` cannot quietly arrive as a hard dependency.
for (const peer of ['react', 'react-dom', 'lexical', '@lexical/react']) {
  check(`${peer} is a peerDependency`, Boolean(packed.peerDependencies?.[peer]))
}

const SINGLE_INSTANCE = /^(react|react-dom|lexical|@lexical\/.+)$/
const hardSingletons = Object.keys(packed.dependencies ?? {}).filter((name) => SINGLE_INSTANCE.test(name))
check(
  'no React or Lexical package is a hard dependency of the packed artifact',
  hardSingletons.length === 0,
  hardSingletons.join(', '),
)

// Both directions, deliberately. A floor alone catches under-peering (a package
// the editor imports left as a hard dependency, the two-registries failure) but
// is blind to over-peering — a name drifting into `peerDependencies` that the
// editor does not import is install burden pushed onto every consumer, and it
// would pass a `>= 14` check silently. So the set is pinned by name: adding a
// twelfth `@lexical/*` is fine, it just has to be a deliberate edit here rather
// than something that arrives unnoticed.
const EXPECTED_PEERS = [
  'react',
  'react-dom',
  'lexical',
  '@lexical/code',
  '@lexical/code-prism',
  '@lexical/link',
  '@lexical/list',
  '@lexical/mark',
  '@lexical/markdown',
  '@lexical/react',
  '@lexical/rich-text',
  '@lexical/selection',
  '@lexical/table',
  '@lexical/utils',
]
const declaredPeers = Object.keys(packed.peerDependencies ?? {}).filter((name) => SINGLE_INSTANCE.test(name))
const missingPeers = EXPECTED_PEERS.filter((name) => !declaredPeers.includes(name))
const unexpectedPeers = declaredPeers.filter((name) => !EXPECTED_PEERS.includes(name))
check(
  `every React/Lexical package the editor imports is peered (${declaredPeers.length} found)`,
  missingPeers.length === 0,
  `not peered: ${missingPeers.join(', ')}`,
)
check(
  'no unexpected React/Lexical package has been added to peerDependencies',
  unexpectedPeers.length === 0,
  `${unexpectedPeers.join(', ')} — if this is intended, add it to EXPECTED_PEERS in this script`,
)

// ADR-075 §4: declaring `sideEffects` re-separated prismjs's core from
// `prism-clike.js` in liminis-app's rolldown graph and crashed the renderer with
// `ReferenceError: Prism is not defined` (138 e2e failures). The side effect
// lives in a transitive dependency, so our own field cannot express it. FR-011
// keeps the prohibition; this is the guard on the *packed* manifest.
check('no sideEffects field is declared', packed.sideEffects === undefined, `got ${JSON.stringify(packed.sideEffects)}`)

check('a LICENSE ships in the tarball', existsSync(join(extractDir, 'package', 'LICENSE')))
check('a README ships in the tarball', existsSync(join(extractDir, 'package', 'README.md')))
for (const doc of ['editor-api.md', 'markdown-pipeline.md', 'annotations.md']) {
  check(`docs/${doc} ships in the tarball`, existsSync(join(extractDir, 'package', 'docs', doc)))
}
check(
  'the vendored wiki-link license ships alongside its code',
  existsSync(join(extractDir, 'package', 'dist', 'markdown', 'vendor', 'mdast-util-wiki-link', 'LICENSE')),
)
check(
  'no TypeScript source ships in the tarball',
  !existsSync(join(extractDir, 'package', 'src')),
)

// The pair to the assertion above. `tsc` emits `.js.map`/`.d.ts.map` whose
// `sources` point at `../src/*.ts`, which `files` guarantees is absent. A
// dangling declaration map is worse than no map: the IDE follows it to a
// missing source and "Go to Definition" fails, where with no map it would land
// on the `.d.ts`. Enabling `declarationMap`/`sourceMap` without also shipping
// `src` is the mistake this catches.
const mapFiles = []
const walkMaps = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkMaps(full)
    else if (full.endsWith('.map')) mapFiles.push(relative(join(extractDir, 'package'), full))
  }
}
walkMaps(join(extractDir, 'package', 'dist'))
check(
  'no sourcemap ships without the sources it points at',
  mapFiles.length === 0,
  `${mapFiles.length} map(s), e.g. ${mapFiles.slice(0, 3).join(', ')}`,
)

// ---------------------------------------------------------------------------
// 2. Emitted declarations must not leak globals
// ---------------------------------------------------------------------------
//
// `src/ambient/jsx.d.ts` performs a `declare global { namespace JSX }`
// augmentation. If anything of that class reached `dist/`, every consumer of the
// package would silently inherit it. ADR-075 records the same defect caught once
// before, when an `acquireVsCodeApi` global leaked through `.` and `./contract`.

step('Probing emitted declarations for global leakage')
const declarationFiles = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (full.endsWith('.d.ts')) declarationFiles.push(full)
  }
}
walk(join(extractDir, 'package', 'dist'))

const leaking = declarationFiles.filter((file) => /declare\s+global/.test(readFileSync(file, 'utf8')))
check(
  `no emitted .d.ts declares a global (${declarationFiles.length} checked)`,
  leaking.length === 0,
  leaking.map((f) => relative(extractDir, f)).join(', '),
)

// ---------------------------------------------------------------------------
// 3. Install the tarball into the external-style consumer
// ---------------------------------------------------------------------------
//
// `--ignore-workspace` is what makes this external rather than theatre: under a
// workspace, pnpm links `@liminis/editor` by symlink to the package directory
// and the tarball — the thing under test — is never resolved at all.
//
// This repository has no `pnpm-workspace.yaml`, so `examples/*` are non-members
// by construction and the flag is belt-and-braces rather than load-bearing. It
// stays because the property it protects is the one this whole script exists to
// prove, and a workspace file added later must not silently turn this into a
// self-test. The `not a workspace symlink` check below is the assertion that
// actually catches that.
//
// The fixture deliberately declares only `react`/`react-dom`, never `lexical`
// or `@lexical/*`. That is not an oversight: peers arriving without being asked
// for is exactly the default adopter experience this fixture exists to model
// (pnpm v8+ and npm v7+ both auto-install peers). Declaring them here would
// make the fixture pass for a reason a real adopter does not enjoy.
//
// The cost is a dependency on `auto-install-peers`, which a corporate `.npmrc`,
// a future pnpm default flip, or a yarn user can switch off. Verified with
// `auto-install-peers=false`: the install still succeeds and both type-checks
// still pass (`skipLibCheck` hides the unresolved types), and the failure only
// surfaces at arm-build time as `Rolldown failed to resolve import "lexical"`
// — which names neither the peer nor the setting. The check below turns that
// into a named failure at the point the cause is still visible.

step('Installing the tarball into examples/external-consumer')
const consumerManifestPath = join(CONSUMER_DIR, 'package.json')
// `pnpm add` writes the tarball's absolute temp path into the manifest. The
// install is what we want; the edit is not — it would be a machine-specific
// path committed to the repo. Snapshot and restore.
const consumerManifest = readFileSync(consumerManifestPath, 'utf8')
try {
  rmSync(join(CONSUMER_DIR, 'node_modules'), { recursive: true, force: true })
  rmSync(join(CONSUMER_DIR, 'pnpm-lock.yaml'), { force: true })
  run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], CONSUMER_DIR)
  run('pnpm', ['add', '--ignore-workspace', tarball], CONSUMER_DIR)
} finally {
  writeFileSync(consumerManifestPath, consumerManifest)
}

const installedManifest = join(CONSUMER_DIR, 'node_modules', '@liminis', 'editor', 'package.json')
check('the consumer resolved a real installed copy, not a workspace symlink', existsSync(installedManifest))
if (existsSync(installedManifest)) {
  const installed = JSON.parse(readFileSync(installedManifest, 'utf8'))
  check('the installed copy resolves through dist/', installed.main === './dist/index.js', `got ${installed.main}`)

  // Look for each declared peer the way a bundler does: walk `node_modules` up
  // from the installed copy's *real* path inside pnpm's virtual store, not from
  // the symlink in the fixture's `node_modules`. Walking from the symlink goes
  // up into the fixture, which only ever declares react/react-dom, so every
  // peer would read as missing on a perfectly good install. Rolldown reports
  // this same real path in its own resolution errors.
  //
  // Presence of the package directory, not `require.resolve` of the bare
  // specifier: `@lexical/react` is subpath-only (no "." in its `exports`), so
  // resolving its bare name throws even when it is correctly installed.
  const peerLookupDir = dirname(realpathSync(installedManifest))
  const unresolved = Object.keys(installed.peerDependencies ?? {}).filter((name) => {
    for (let dir = peerLookupDir; ; ) {
      if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return false
      const parent = dirname(dir)
      if (parent === dir) return true
      dir = parent
    }
  })
  check(
    'every declared peer resolves from the installed copy',
    unresolved.length === 0,
    unresolved.length === 0
      ? undefined
      : `unresolved: ${unresolved.join(', ')} — the fixture declares only react/react-dom and relies on ` +
        "pnpm's auto-install-peers default. If that is off (corporate .npmrc, a pnpm default change, or " +
        'yarn), either re-enable it or add these to the fixture manifest.',
  )
}

// ---------------------------------------------------------------------------
// 4. Type-check under both resolution modes
// ---------------------------------------------------------------------------

step('Type-checking the consumer (moduleResolution: bundler)')
run('pnpm', ['run', 'typecheck:bundler'], CONSUMER_DIR)
check('all seven subpaths type-check under "bundler"', true)

step('Type-checking the consumer (moduleResolution: nodenext)')
run('pnpm', ['run', 'typecheck:nodenext'], CONSUMER_DIR)
check('all code subpaths type-check under "nodenext"', true)

// Both runs above set `skipLibCheck: true`, as every real consumer's tsconfig
// does — which means neither of them checks the editor's own emitted `.d.ts` at
// all. That hides a specific hazard: `src/ambient/jsx.d.ts` supplies a global
// `JSX` namespace that React 19's types no longer provide, and ambient files are
// never emitted to `dist/`. Several emitted declarations do name bare
// `JSX.Element`; none is reachable from a public entry today, so an adopter
// never loads them — but nothing was holding that.
//
// Run the same program with `skipLibCheck` off and filter the errors to those
// originating inside the installed editor. Errors from other packages'
// declarations (@mathjax/src and lexical both have some) are not ours and are
// deliberately ignored — the assertion is that *our* shipped declarations are
// self-contained, not that the whole graph is clean under a mode nobody uses.
step('Type-checking the consumer with skipLibCheck off (emitted declarations)')
let declarationDiagnostics = ''
try {
  run('pnpm', ['run', 'typecheck:declarations'], CONSUMER_DIR)
} catch (error) {
  declarationDiagnostics = `${error.stdout ?? ''}`
}
const ourDeclarationErrors = declarationDiagnostics
  .split('\n')
  .filter((line) => /error TS\d+/.test(line) && line.includes('@liminis/editor'))
check(
  'no emitted declaration fails to type-check on its own terms',
  ourDeclarationErrors.length === 0,
  ourDeclarationErrors.slice(0, 5).join('\n      '),
)

// ---------------------------------------------------------------------------
// 5. Build the measurement arms
// ---------------------------------------------------------------------------

step('Building the three measurement arms')
const graphs = {}
for (const arm of ARMS) {
  run('pnpm', ['run', 'build:arm'], CONSUMER_DIR, { ARM: arm })
  graphs[arm] = JSON.parse(readFileSync(join(CONSUMER_DIR, 'dist', arm, 'modules.json'), 'utf8'))
  console.log(`  ${arm}: ${Object.keys(graphs[arm].chunks).length} chunk(s)`)
}

/**
 * The modules a consumer loads *eagerly*: the entry chunk plus everything
 * reachable from it through static imports. Dynamic imports are deliberately not
 * followed — a `React.lazy()` chunk is fetched only if something renders it, and
 * that difference is the whole mechanism under test.
 */
function eagerModules(graph) {
  const entry = Object.entries(graph.chunks).find(([, c]) => c.isEntry)?.[0]
  if (!entry) throw new Error(`no entry chunk in ${graph.arm}`)
  const seen = new Set()
  const queue = [entry]
  const modules = new Set()
  while (queue.length) {
    const name = queue.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const chunk = graph.chunks[name]
    if (!chunk) continue
    chunk.modules.forEach((m) => modules.add(m))
    chunk.imports.forEach((i) => queue.push(i))
  }
  return modules
}

function asyncModules(graph) {
  const eager = eagerModules(graph)
  const all = new Set()
  for (const chunk of Object.values(graph.chunks)) chunk.modules.forEach((m) => all.add(m))
  return new Set([...all].filter((m) => !eager.has(m)))
}

const matches = (modules, pattern) => [...modules].filter((m) => pattern.test(m))

// --- SC-002: `./markdown` must not drag `./headless`'s MathJax weight -------
//
// The single highest-consequence silent regression in this package. Nothing
// errors if it breaks; a markdown-only consumer just gets ~2.3 MB heavier.

step('SC-002 — a ./markdown-only consumer carries no MathJax weight')
const markdownEager = eagerModules(graphs['markdown-only'])
const mathjaxHits = matches(markdownEager, /mathjax|@mathjax[\\/]src/i)
check(
  `no MathJax module in the markdown-only graph (${markdownEager.size} modules)`,
  mathjaxHits.length === 0,
  mathjaxHits.slice(0, 5).join(', '),
)
const lexicalHits = matches(markdownEager, /[\\/]node_modules[\\/](@lexical|lexical)[\\/]/)
check('no Lexical module in the markdown-only graph', lexicalHits.length === 0, lexicalHits.slice(0, 5).join(', '))
const reactHits = matches(markdownEager, /[\\/]node_modules[\\/]react-dom[\\/]/)
check('no react-dom in the markdown-only graph', reactHits.length === 0, reactHits.slice(0, 5).join(', '))

// --- SC-004: opting out of annotations is genuinely free --------------------
//
// Scoped per ADR-077 to `AnnotationSurface` and the `annotations/` modules, not
// to "the string `annotation` does not appear": the ADR records two deliberate
// exceptions that are *not* behind the lazy boundary — unconditional `MarkNode`
// registration and a statically-importable `annotationCommands.ts` — so both
// arms are expected to contain those.

step('SC-004 — an annotations-disabled consumer carries no annotation code')
const ANNOTATION_MODULE = /@liminis[\\/]editor[\\/]dist[\\/](annotations[\\/]|app[\\/]editor[\\/]Annotation)/

const offEager = eagerModules(graphs['annotations-off'])
const offHits = matches(offEager, ANNOTATION_MODULE)
check(
  `no annotation module loads eagerly with no kinds configured (${offEager.size} modules)`,
  offHits.length === 0,
  offHits.slice(0, 8).join(', '),
)

const offAsync = asyncModules(graphs['annotations-off'])
check(
  'AnnotationSurface is isolated in an async chunk, not the eager graph',
  matches(offAsync, /AnnotationSurface/).length > 0 && matches(offEager, /AnnotationSurface/).length === 0,
  `eager=${matches(offEager, /AnnotationSurface/).length} async=${matches(offAsync, /AnnotationSurface/).length}`,
)

// The control. Without this, the assertion above could be passing because the
// probe is looking in the wrong place.
const onEager = eagerModules(graphs['annotations-on'])
const onHits = matches(onEager, ANNOTATION_MODULE)
check(
  `the same probe does find annotation modules when a kind is configured (${onHits.length} found)`,
  onHits.length > 0,
)

// ---------------------------------------------------------------------------

// `packDir`/`extractDir` are removed by the `exit` handler registered at the
// top, so a failing arm above cleans up as reliably as a passing one.

console.log('')
if (failures > 0) {
  console.error(`[31m${failures} check(s) failed[0m`)
  process.exit(1)
}
console.log('[32mAll package-publishability checks passed[0m')

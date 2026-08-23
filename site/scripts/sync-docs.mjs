#!/usr/bin/env node
/**
 * Generate the Starlight content collection from the repository's own docs/.
 *
 * docs/*.md is not moved and not modified. It cannot be: it ships inside the
 * published tarball (package.json's `files` field, so an adopter reads it in
 * their own node_modules), tests/adr-citations.test.ts walks it, and it is
 * cited by path from source doc-comments, ADRs, the CHANGELOG and specs.
 * Adding Starlight frontmatter to those files would also put a YAML table at
 * the top of every page as GitHub renders it.
 *
 * So the site reads them and writes an annotated copy here instead:
 *
 *   - `title` comes from the file's H1, which every one of these pages already
 *     has, so nothing has to be authored twice.
 *   - That H1 is then dropped from the body, because Starlight renders the
 *     frontmatter title as the page heading and two would be one too many.
 *   - `sidebar.order` comes from the ORDER list below — the only thing here
 *     that has to be maintained by hand, and only to say what reads first.
 *
 * The output lands under src/content/docs/guide/, is generated, and is
 * gitignored accordingly. `pnpm dev` and `pnpm build` both run this first, so
 * it cannot go stale.
 *
 * Deliberately not a custom Astro loader: a loader would give live reload, at
 * the cost of machinery that mutates the content store and a second remark
 * plugin to strip the duplicate heading. This is a file copy with a header,
 * and it is obvious what it did when something looks wrong.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = dirname(dirname(fileURLToPath(import.meta.url)))
const SOURCE = join(dirname(SITE), 'docs')
// Generated pages live in their own subdirectory so this script can clear it
// wholesale without touching the hand-authored pages (the homepage, and
// anything else written for the site rather than for the repository).
const OUT = join(SITE, 'src/content/docs/guide')

/**
 * Reading order. A page missing from this list still ships — it just sorts
 * after the ones named here, alphabetically, rather than failing the build.
 * Silent omission beats a build that breaks because someone added a page.
 */
const ORDER = [
  'editor-api',
  'markdown-pipeline',
  'annotations',
  'zusammen-editor-capability-map',
  'provenance',
]

/** One-line summaries, used for the sidebar and for search results. */
const DESCRIPTIONS = {
  'editor-api': 'The <Editor> component, the host seam, and the handle a host holds.',
  'markdown-pipeline': 'Markdown in, Lexical state out, markdown back — and what survives the trip.',
  annotations: 'Ranges anchored to a document that outlive edits to it.',
  'zusammen-editor-capability-map': 'Which capabilities live in the editor and which belong to a host.',
  provenance: 'Where this package came from, and how to read its ADR references.',
}

const yaml = (s) => `"${s.replace(/"/g, '\\"')}"`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const pages = readdirSync(SOURCE).filter((f) => f.endsWith('.md'))
if (pages.length === 0) {
  console.error(`No markdown found in ${SOURCE}`)
  process.exit(1)
}

let written = 0
for (const file of pages) {
  const slug = file.replace(/\.md$/, '')
  const body = readFileSync(join(SOURCE, file), 'utf8')

  const heading = /^#\s+(.+?)\s*$/m.exec(body)
  if (!heading) {
    console.error(`${file}: no H1, so there is no title to give the page`)
    process.exit(1)
  }

  // Strip the H1 only where it is, rather than the first match anywhere: a
  // fenced code block containing a `# comment` line must not be mistaken for
  // the page heading and deleted.
  const withoutHeading = body.slice(0, heading.index) + body.slice(heading.index + heading[0].length)

  const order = ORDER.indexOf(slug)
  const frontmatter = [
    '---',
    `title: ${yaml(heading[1].replace(/`/g, ''))}`,
    DESCRIPTIONS[slug] ? `description: ${yaml(DESCRIPTIONS[slug])}` : null,
    order === -1 ? null : `sidebar:\n  order: ${order + 1}`,
    '---',
  ]
    .filter(Boolean)
    .join('\n')

  // Written as .mdx, not .md. The fence-to-island swap produces JSX nodes, and
  // Astro only evaluates those in MDX — as plain markdown the page renders the
  // fence as a code block and the island never appears. The source file in
  // docs/ stays .md, so nothing about how GitHub or the tarball sees it changes.
  writeFileSync(
    join(OUT, file.replace(/\.md$/, '.mdx')),
    `${frontmatter}\n${withoutHeading.replace(/^\n+/, '\n')}`,
  )
  written += 1
}

console.log(`${written} page(s) generated from ${SOURCE}`)

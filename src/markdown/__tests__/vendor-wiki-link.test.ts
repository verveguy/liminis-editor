/**
 * Parity tests for the vendored `mdast-util-wiki-link` (#940 / FR-005).
 *
 * These exercise the vendored module *directly*, not through `parseMarkdown`.
 * That matters: `parseMarkdown` runs `stripEscapedPipeFromWikiLinks` as a
 * defense-in-depth post-pass, so a regression in the vendored strip would be
 * masked there for `node.value` — but not for `data.permalink`, which is
 * computed inside the extension from the target as it stands at that moment.
 * Testing the extension directly is what pins the whole node shape.
 */
import { describe, it, expect } from 'vitest'
import { fromMarkdown as mdastFromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown as mdastToMarkdown } from 'mdast-util-to-markdown'
import { syntax as wikiLinkSyntax } from 'micromark-extension-wiki-link'
import {
  fromMarkdown as wikiLinkFromMarkdown,
  toMarkdown as wikiLinkToMarkdown,
} from '../vendor/mdast-util-wiki-link'

const OPTIONS = { aliasDivider: '|' }

interface WikiLinkNode {
  type: 'wikiLink'
  value: string
  data: {
    alias: string
    permalink: string
    exists: boolean
    hName?: string
    hProperties?: { className: string; href: string }
    hChildren?: { type: string; value: string }[]
  }
}

function parse(text: string, opts: Record<string, unknown> = {}): WikiLinkNode[] {
  const root = mdastFromMarkdown(text, {
    extensions: [wikiLinkSyntax(OPTIONS)],
    mdastExtensions: [wikiLinkFromMarkdown({ ...OPTIONS, ...opts })],
  } as never)

  const found: WikiLinkNode[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; children?: unknown[] }
    if (n.type === 'wikiLink') found.push(node as WikiLinkNode)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(root)
  return found
}

describe('vendored mdast-util-wiki-link — fromMarkdown', () => {
  it('parses a plain wiki-link', () => {
    const [link] = parse('A [[page]] link.')
    expect(link.value).toBe('page')
    expect(link.data.alias).toBe('page')
    expect(link.data.permalink).toBe('page')
    expect(link.data.exists).toBe(false)
  })

  it('parses an aliased wiki-link', () => {
    const [link] = parse('A [[some page|Display]] link.')
    expect(link.value).toBe('some page')
    expect(link.data.alias).toBe('Display')
    // Default pageResolver lowercases and underscores.
    expect(link.data.permalink).toBe('some_page')
  })

  it('resolves against supplied permalinks', () => {
    const [link] = parse('[[page]]', { permalinks: ['page'] })
    expect(link.data.exists).toBe(true)
    expect(link.data.permalink).toBe('page')
    expect(link.data.hProperties?.className).toBe('internal')
  })

  it('marks an unresolved link as new', () => {
    const [link] = parse('[[nope]]', { permalinks: ['page'] })
    expect(link.data.exists).toBe(false)
    expect(link.data.hProperties?.className).toBe('internal new')
  })

  it('emits the upstream hast shim fields', () => {
    const [link] = parse('[[page|Alias]]')
    expect(link.data.hName).toBe('a')
    expect(link.data.hProperties?.href).toBe('#/page/page')
    expect(link.data.hChildren).toEqual([{ type: 'text', value: 'Alias' }])
  })

  // --- The patched behaviour this vendoring exists to preserve (#347) --------

  it('strips a trailing backslash from an aliased target', () => {
    const [link] = parse('[[page\\|Alias]]')
    expect(link.value).toBe('page')
    expect(link.data.alias).toBe('Alias')
  })

  it('computes permalink and exists from the *stripped* target', () => {
    // This is the assertion a `value`-only post-pass cannot satisfy: upstream
    // resolves the permalink before any post-processing runs, so an unstripped
    // `page\` would resolve to `page\` and miss the permalink match entirely.
    const [link] = parse('[[page\\|Alias]]', { permalinks: ['page'] })
    expect(link.value).toBe('page')
    expect(link.data.permalink).toBe('page')
    expect(link.data.exists).toBe(true)
  })

  it('leaves a trailing backslash alone when there is no alias', () => {
    const [link] = parse('[[page\\]]')
    expect(link.value).toBe('page\\')
  })
})

describe('vendored mdast-util-wiki-link — toMarkdown', () => {
  const stringify = (tree: unknown): string =>
    mdastToMarkdown(tree as never, { extensions: [wikiLinkToMarkdown(OPTIONS)] }).trim()

  it('serializes a plain wiki-link', () => {
    const tree = {
      type: 'paragraph',
      children: [{ type: 'wikiLink', value: 'page', data: { alias: 'page' } }],
    }
    expect(stringify(tree)).toBe('[[page]]')
  })

  it('serializes an aliased wiki-link with the configured divider', () => {
    const tree = {
      type: 'paragraph',
      children: [{ type: 'wikiLink', value: 'page', data: { alias: 'Display' } }],
    }
    expect(stringify(tree)).toBe('[[page|Display]]')
  })

  it('round-trips an aliased wiki-link through parse and serialize', () => {
    const [link] = parse('[[some page|Display]]')
    const tree = { type: 'paragraph', children: [link] }
    expect(stringify(tree)).toBe('[[some page|Display]]')
  })

  // Upstream passed the alias through `safe()` unconditionally, and
  // `safe(undefined)` yields `''` — unequal to a non-empty target, so a node
  // with no alias serialized as the malformed `[[page|]]`, which parses back as
  // an *empty* alias rather than none. A host hand-building nodes (the reason
  // this extension is exported at all) is the only way to reach it.
  it.each([
    ['undefined data', { type: 'wikiLink', value: 'page' }],
    ['empty data', { type: 'wikiLink', value: 'page', data: {} }],
    ['null alias', { type: 'wikiLink', value: 'page', data: { alias: null } }],
    ['empty-string alias', { type: 'wikiLink', value: 'page', data: { alias: '' } }],
  ])('serializes a node with no alias (%s) as a bare wiki-link', (_label, node) => {
    expect(stringify({ type: 'paragraph', children: [node] })).toBe('[[page]]')
  })

  // The guard above must not change anything the parser can actually produce.
  // `fromMarkdown` always populates `data.alias` (falling back to the target),
  // so the guard is unreachable from parsed input and these outputs are exactly
  // what upstream produced. Note `[[page|page]]` collapsing to `[[page]]` is the
  // pre-existing `alias === value` rule, not an effect of the guard.
  it.each([
    ['[[page]]', '[[page]]'],
    ['[[some page|Display]]', '[[some page|Display]]'],
    ['[[page|page]]', '[[page]]'],
  ])('leaves parser-produced node %s unaffected by the no-alias guard', (source, expected) => {
    const [link] = parse(source)
    expect(link.data.alias, `${source} should carry an alias`).toBeTruthy()
    expect(stringify({ type: 'paragraph', children: [link] })).toBe(expected)
  })
})

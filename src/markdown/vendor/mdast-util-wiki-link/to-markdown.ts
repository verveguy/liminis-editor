/**
 * Vendored from `mdast-util-wiki-link@0.1.2` (MIT, Mark Hudnall — see LICENSE
 * in this directory).
 *
 * Two deliberate divergences from upstream:
 *   1. Upstream imports `mdast-util-to-markdown/lib/util/safe` from **v0.6.5**
 *      of that package, a deep import into a v0 duplicate of the v2
 *      `mdast-util-to-markdown` this package already uses. That duplicate
 *      (and upstream's `@babel/runtime` dependency) exists solely to serve
 *      this file. Here the same escaping is done through v2's `state.safe()`,
 *      which is the supported API and produces the same result for the
 *      `{ before: '[', after: ']' }` case this handler uses.
 *   2. A `data.blockId` fragment (#119) is re-appended as `#^blockId` after
 *      the target, mirroring the split `from-markdown.ts` performs on the way
 *      in — so a raw `./markdown`-subpath consumer building `wikiLink` nodes
 *      by hand (not just `parseMarkdown`) gets byte-identical round-tripping
 *      of the block-id fragment.
 */
import type { Handle, Options as ToMarkdownExtension, State } from 'mdast-util-to-markdown'

export interface WikiLinkToMarkdownOptions {
  aliasDivider?: string
}

interface WikiLinkNodeLike {
  type: 'wikiLink'
  value: string
  data?: { alias?: string | null; blockId?: string | null }
}

export function toMarkdown(opts: WikiLinkToMarkdownOptions = {}): ToMarkdownExtension {
  const aliasDivider = opts.aliasDivider || ':'

  const handler: Handle = (node, _parent, state: State) => {
    const wikiLink = node as unknown as WikiLinkNodeLike
    const exit = state.enter('wikiLink' as never)

    const nodeValue = state.safe(wikiLink.value, { before: '[', after: ']' })
    const blockId = wikiLink.data?.blockId
    const targetText = typeof blockId === 'string' && blockId.length > 0 ? `${nodeValue}#^${blockId}` : nodeValue

    // Second deliberate divergence from upstream. Upstream passes the alias
    // through `safe()` unconditionally; `safe(undefined)` yields `''`, which is
    // then unequal to a non-empty target, so a node carrying *no* alias
    // serialized as `[[Target<divider>]]`. That output is malformed — it does
    // not round-trip, parsing back as an empty alias rather than none.
    //
    // Nothing in this repository could reach it (`fromMarkdown` always populates
    // `data.alias`, falling back to the target), so this changes no in-repo
    // behaviour. It only matters to an external host that builds `wikiLink`
    // nodes by hand — which is precisely who the published package is for.
    const rawAlias = wikiLink.data?.alias
    const hasAlias = typeof rawAlias === 'string' && rawAlias.length > 0
    const nodeAlias = hasAlias ? state.safe(rawAlias, { before: '[', after: ']' }) : nodeValue

    const value =
      nodeAlias !== nodeValue ? `[[${targetText}${aliasDivider}${nodeAlias}]]` : `[[${targetText}]]`

    exit()

    return value
  }

  return {
    unsafe: [
      { character: '[', inConstruct: ['phrasing', 'label', 'reference'] },
      { character: ']', inConstruct: ['label', 'reference'] },
    ],
    // `wikiLink` is not a node type mdast knows about — it is contributed by the
    // micromark wiki-link syntax extension — so `Handlers` cannot name it.
    handlers: { wikiLink: handler } as unknown as ToMarkdownExtension['handlers'],
  }
}

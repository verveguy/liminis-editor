/**
 * Vendored from `mdast-util-wiki-link@0.1.2` (MIT, Mark Hudnall — see LICENSE
 * in this directory).
 *
 * One deliberate divergence from upstream: upstream imports
 * `mdast-util-to-markdown/lib/util/safe` from **v0.6.5** of that package, a
 * deep import into a v0 duplicate of the v2 `mdast-util-to-markdown` this
 * package already uses. That duplicate (and upstream's `@babel/runtime`
 * dependency) exists solely to serve this file. Here the same escaping is done
 * through v2's `state.safe()`, which is the supported API and produces the same
 * result for the `{ before: '[', after: ']' }` case this handler uses.
 */
import type { Handle, Options as ToMarkdownExtension, State } from 'mdast-util-to-markdown'

export interface WikiLinkToMarkdownOptions {
  aliasDivider?: string
}

interface WikiLinkNodeLike {
  type: 'wikiLink'
  value: string
  data?: { alias?: string | null }
}

export function toMarkdown(opts: WikiLinkToMarkdownOptions = {}): ToMarkdownExtension {
  const aliasDivider = opts.aliasDivider || ':'

  const handler: Handle = (node, _parent, state: State) => {
    const wikiLink = node as unknown as WikiLinkNodeLike
    const exit = state.enter('wikiLink' as never)

    const nodeValue = state.safe(wikiLink.value, { before: '[', after: ']' })
    const nodeAlias = state.safe(wikiLink.data?.alias ?? undefined, { before: '[', after: ']' })

    const value =
      nodeAlias !== nodeValue ? `[[${nodeValue}${aliasDivider}${nodeAlias}]]` : `[[${nodeValue}]]`

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

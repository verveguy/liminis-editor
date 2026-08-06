/**
 * Vendored from `mdast-util-wiki-link@0.1.2` (MIT, Mark Hudnall — see LICENSE
 * in this directory), with the Liminis trailing-backslash fix applied inline.
 *
 * Why vendored rather than depended-upon-and-patched: the upstream behaviour we
 * need was only reachable through a `pnpm` `patchedDependencies` entry, which
 * does not travel outside this monorepo. An external consumer of the published
 * package would silently get different — and wrong — wiki-link behaviour inside
 * markdown tables (#347). Vendoring makes the package self-contained.
 *
 * Four deliberate divergences from upstream:
 *   1. The trailing-backslash strip (see `exitWikiLink`), previously carried as
 *      `liminis-app/patches/mdast-util-wiki-link@0.1.2.patch`.
 *   2. Real types instead of `any` on the public option and node shapes.
 *   3. `exitWikiLink` reads the node off `this.stack` rather than off a
 *      closure variable shared by every handler in one `fromMarkdown()` call.
 *   4. `top()` asserts the stack frame is actually a wiki-link, so the
 *      cannot-nest assumption fails loudly rather than corrupting a sibling node.
 *
 * Nothing else about the parse behaviour changes: `value`, `data.alias`,
 * `data.permalink`, `data.exists`, `data.hName`, `data.hProperties` and
 * `data.hChildren` are computed exactly as upstream computes them.
 */

export interface WikiLinkFromMarkdownOptions {
  permalinks?: string[]
  pageResolver?: (name: string) => string[]
  newClassName?: string
  wikiLinkClassName?: string
  hrefTemplate?: (permalink: string) => string
  /** Accepted and ignored here; consumed by `toMarkdown` and the micromark syntax extension. */
  aliasDivider?: string
}

interface WikiLinkNode {
  type: 'wikiLink'
  value: string
  data: {
    alias: string | null
    permalink: string | null
    exists: boolean | null
    hName?: string
    hProperties?: { className: string; href: string }
    hChildren?: { type: 'text'; value: string }[]
  }
}

/**
 * The subset of `mdast-util-from-markdown`'s `CompileContext` this handler uses.
 * Typed structurally so the vendored module does not depend on that package's
 * (unexported, version-specific) context type.
 */
interface WikiLinkCompileContext {
  stack: unknown[]
  enter: (node: WikiLinkNode, token: unknown) => void
  exit: (token: unknown) => void
  sliceSerialize: (token: unknown) => string
}

/**
 * The node currently being built, read off the compile stack.
 *
 * The type check is not ceremony. Every handler here assumes the top of the
 * stack is the wiki-link it entered, which holds because wiki-links cannot
 * nest — but nothing in this file *enforces* that, and there is no upstream
 * left to diff against. If a future micromark extension change, or a consumer
 * combining extensions, ever let a second wiki-link token open while one is
 * still on the stack, the handlers would quietly write `value`, `alias`,
 * `permalink` and `hChildren` onto the wrong node and the corruption would
 * surface as mis-rendered links, not as an error. Failing loudly here converts
 * that into a stack trace naming this file.
 */
function top(stack: unknown[]): WikiLinkNode {
  const node = stack[stack.length - 1] as WikiLinkNode | undefined
  if (node?.type !== 'wikiLink') {
    throw new Error(
      `wiki-link handler expected a wikiLink on top of the mdast stack, found ${
        node === undefined ? 'an empty stack' : `a ${String(node.type)}`
      }. Wiki-links are assumed not to nest; if that changed, these handlers need per-node state.`
    )
  }
  return node
}

export function fromMarkdown(opts: WikiLinkFromMarkdownOptions = {}) {
  const permalinks = opts.permalinks || []
  const defaultPageResolver = (name: string) => [name.replace(/ /g, '_').toLowerCase()]
  const pageResolver = opts.pageResolver || defaultPageResolver
  const newClassName = opts.newClassName || 'new'
  const wikiLinkClassName = opts.wikiLinkClassName || 'internal'
  const defaultHrefTemplate = (permalink: string) => `#/page/${permalink}`
  const hrefTemplate = opts.hrefTemplate || defaultHrefTemplate

  function enterWikiLink(this: WikiLinkCompileContext, token: unknown): void {
    const node: WikiLinkNode = {
      type: 'wikiLink',
      value: null as unknown as string,
      data: {
        alias: null,
        permalink: null,
        exists: null,
      },
    }
    this.enter(node, token)
  }

  function exitWikiLinkAlias(this: WikiLinkCompileContext, token: unknown): void {
    top(this.stack).data.alias = this.sliceSerialize(token)
  }

  function exitWikiLinkTarget(this: WikiLinkCompileContext, token: unknown): void {
    top(this.stack).value = this.sliceSerialize(token)
  }

  function exitWikiLink(this: WikiLinkCompileContext, token: unknown): void {
    // Read the node off the stack *before* exiting — `this.exit()` pops it, so
    // afterwards `top(this.stack)` is the parent. Upstream reads a closure
    // variable here instead, which every handler produced by one
    // `fromMarkdown()` call shares: `exitWikiLink` would then operate on
    // whichever token last entered, not the one actually exiting. Wiki links
    // cannot nest today, so the two are equivalent in practice — this just
    // declines to inherit the assumption.
    const wikiLink = top(this.stack)
    this.exit(token)

    // --- Liminis divergence from upstream (#347) ------------------------------
    // Strip a trailing backslash from the target only when an alias is present.
    // `parseMarkdown` escapes the alias divider (`\|`) before parsing so GFM
    // table parsing does not split a wiki-link at its pipe; that backslash
    // escapes the pipe for the table parser but is not part of the target. We
    // strip only when an alias exists, so a target that legitimately ends in a
    // backslash is left alone.
    //
    // The strip happens *before* `pageResolver` runs, so `data.permalink` and
    // `data.exists` are computed from the stripped value — matching the patched
    // behaviour this replaces. A post-pass that fixed only `value` would not.
    if (wikiLink.data.alias && wikiLink.value?.endsWith('\\')) {
      wikiLink.value = wikiLink.value.slice(0, -1)
    }
    // --------------------------------------------------------------------------

    const pagePermalinks = pageResolver(wikiLink.value)
    const target = pagePermalinks.find((p) => permalinks.includes(p))
    const exists = target !== undefined

    const permalink = exists ? target : pagePermalinks[0] || ''

    let displayName = wikiLink.value
    if (wikiLink.data.alias) {
      displayName = wikiLink.data.alias
    }

    let classNames = wikiLinkClassName
    if (!exists) {
      classNames += ' ' + newClassName
    }

    wikiLink.data.alias = displayName
    wikiLink.data.permalink = permalink
    wikiLink.data.exists = exists

    wikiLink.data.hName = 'a'
    wikiLink.data.hProperties = {
      className: classNames,
      href: hrefTemplate(permalink),
    }
    wikiLink.data.hChildren = [{ type: 'text', value: displayName }]
  }

  return {
    enter: {
      wikiLink: enterWikiLink,
    },
    exit: {
      wikiLinkTarget: exitWikiLinkTarget,
      wikiLinkAlias: exitWikiLinkAlias,
      wikiLink: exitWikiLink,
    },
  }
}

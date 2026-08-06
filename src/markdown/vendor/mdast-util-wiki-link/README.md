# Vendored `mdast-util-wiki-link`

Source: [`landakram/mdast-util-wiki-link`](https://github.com/landakram/mdast-util-wiki-link) v0.1.2,
MIT-licensed (see `LICENSE`). Copyright (c) 2020 Mark Hudnall.

## Why this is vendored

The behaviour this package needs was previously obtained by patching the npm
dependency through pnpm's `patchedDependencies`, in
`liminis-app/patches/mdast-util-wiki-link@0.1.2.patch`. A pnpm patch is a
property of *this workspace*, not of the published package: an external consumer
of `@liminis/editor` installing from a registry would get the unpatched
upstream, and would silently get different — and wrong — round-trip behaviour for
wiki-links inside markdown tables.

Vendoring makes `@liminis/editor` self-contained (#940 / FR-004), and removes
the `mdast-util-to-markdown@0.6.5` + `@babel/runtime` duplicate dependency graph
upstream pulled in.

## Divergences from upstream

1. **Trailing-backslash strip in `from-markdown.ts`.** When a wiki-link has an
   alias and its target ends with a backslash, the backslash is dropped before
   the target is resolved. This is the fix for
   [#347](https://github.com/verveguy/liminis/issues/347) — `parseMarkdown`
   escapes the alias divider (`\|`) so that GFM table parsing does not split a
   wiki-link at its pipe, and the escape must not survive into the target.
   Removing this behaviour re-breaks whole markdown tables that contain an
   aliased wiki-link, not just the link. Do not re-remove it.

   Because the strip happens *before* `pageResolver` runs, `data.permalink` and
   `data.exists` are derived from the stripped value, exactly as under the patch.

2. **`to-markdown.ts` uses `mdast-util-to-markdown` v2's `state.safe()`** rather
   than upstream's deep import of `mdast-util-to-markdown/lib/util/safe` from
   v0.6.5. Same escaping, no duplicate dependency.

3. **Types.** The `any`-typed option and node shapes are given real types.

Parse and serialize behaviour is otherwise unchanged. Parity is covered by
`src/markdown/__tests__/vendor-wiki-link.test.ts`.

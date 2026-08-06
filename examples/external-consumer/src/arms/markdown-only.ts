/**
 * Arm 1 — a consumer that only *reads* markdown.
 *
 * The whole point of the `./markdown` subpath is that it is not `./headless`:
 * `./headless` re-exports the MathJax configuration, whose ~90 bare
 * `import '@mathjax/src/js/input/tex/…Configuration.js'` lines are genuinely
 * side-effectful and cannot be tree-shaken by anyone (~1.9 MB). This arm's
 * emitted module graph is asserted to contain none of it (SC-002).
 */
import { parseMarkdown, isHeading, isText, getFileType } from '@liminis/editor/markdown'

export function tableOfContents(markdown: string): string[] {
  const { root } = parseMarkdown(markdown)
  return root.children
    .filter(isHeading)
    .map((heading) => heading.children.filter(isText).map((t) => t.value).join(''))
}

export function classify(path: string): string {
  return getFileType(path)
}

// Keep the entry from being tree-shaken to nothing.
;(globalThis as Record<string, unknown>).__markdownOnlyArm = { tableOfContents, classify }

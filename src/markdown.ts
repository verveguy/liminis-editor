/**
 * `@liminis/editor/markdown` — the markdown-parsing surface, with no editor.
 *
 * The root barrel (`.`) pulls in Lexical, MathJax, Mermaid and the C4 subsystem,
 * because it exports `<Editor>`/`<App>`. A consumer that only needs to *read*
 * markdown — rendering a search-result snippet, building a table of contents —
 * pays all of that at window startup if it reaches for the barrel. This entry
 * exists so it doesn't have to.
 *
 * Everything here is pure mdast/micromark plus a string helper: no DOM, no
 * Lexical, no React. It is deliberately **not** part of `./headless`, which
 * additionally re-exports `mathjax-config` — whose ~90 bare
 * `import '@mathjax/src/js/input/tex/…Configuration.js'` lines are genuinely
 * side-effectful and cannot be shaken by anyone, costing a ~1.9 MB chunk.
 *
 * Do not add anything to this entry whose import graph reaches Lexical, React,
 * MathJax, or the C4 subsystem. See ADR-075.
 *
 * (The sibling `src/markdown/` directory holds the implementation; `./markdown`
 * resolves to this file, `./markdown/parse` to the module inside it.)
 */

export { parseMarkdown } from './markdown/parse'
export type { ParseOptions, ParseResult } from './markdown/parse'
export {
  isParagraph,
  isHeading,
  isList,
  isListItem,
  isBlockquote,
  isCode,
  isThematicBreak,
  isTable,
  isImage,
  isLink,
  isHtml,
  isText,
  isStrong,
  isEmphasis,
  isInlineCode,
  isDelete,
} from './markdown/parse'

export { getFileType } from './utils/file-types'
export type { FileType } from './utils/file-types'

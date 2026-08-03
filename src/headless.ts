/**
 * `@liminis/editor/headless` — the DOM-free surface.
 *
 * Consumed by the Electron **main** process, which compiles with `lib: ["ES2024"]`
 * and no DOM libs. Nothing re-exported from here may transitively import
 * Lexical, `react-dom` (client), or anything that touches `document`/`window`.
 * `renderC4DiagramToSVG` uses `react-dom/server`, which is DOM-free.
 *
 * If you are tempted to widen this entry, check first that the addition still
 * typechecks under `liminis-app/tsconfig.main.json` — the fix is to prune the
 * import graph, never to widen main's `lib`.
 */

// C4 diagram subsystem — parse, layout, and server-side SVG rendering
export { renderC4DiagramToSVG } from './app/editor/c4/render-to-string'
export { parseC4, validateC4 } from './app/editor/c4/parser'
export { layoutC4Diagram } from './app/editor/c4/layout'
export {
  isSystem,
  isContainer,
  isComponent,
  isPerson,
  isExternal,
  isBoundary,
} from './app/editor/c4/types'
export type {
  C4ElementType,
  C4Shape,
  C4Direction,
  C4Style,
  C4Properties,
  C4Element,
  C4Relationship,
  C4Diagram,
  Point,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
  LayoutOptions,
  ParseError,
  ParseResult,
  ManualLayout,
} from './app/editor/c4/types'

// MathJax document factories (equation rendering, server-side export)
export {
  createLiteAdaptorDocument,
  createBrowserAdaptorDocument,
  TEX_PACKAGES,
} from './mathjax-config'
export type {
  TeXPackage,
  MathDocument,
  LiteMathJaxInstance,
  BrowserMathJaxInstance,
} from './mathjax-config'

// File-type detection, used by both the mdast mapper and app-side callers
export { getFileType } from './utils/file-types'
export type { FileType } from './utils/file-types'

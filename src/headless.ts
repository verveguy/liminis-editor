/**
 * `@liminis/editor/headless` — the DOM-free surface.
 *
 * Consumed by the Electron **main** process, which declares `lib: ["ES2024"]`
 * and no DOM libs. Nothing exported from here may reference a DOM global or
 * transitively import Lexical, `react-dom` (client), or anything that touches
 * `document`/`window`. `renderC4DiagramToSVG` uses `react-dom/server`, which is
 * DOM-free; the MathJax *lite* adaptor is typed over `LiteElement`, not
 * `HTMLElement`, which is why only the lite factory appears here.
 *
 * **Known exception, carried over unchanged: `./mathjax-config`.** Its
 * `createLiteAdaptorDocument` export is DOM-free, but the module statically
 * imports `browserAdaptor` alongside `liteAdaptor` at top level, so anything
 * that loads this entry evaluates a DOM-adaptor module. That is *not* a
 * regression introduced by the extraction — before it, `main/remote-session/
 * routes.ts` imported `shared/mathjax-config` directly and pulled in the very
 * same graph; main's runtime imports are byte-for-byte what they were. It is
 * called out here because this entry's contract would otherwise read as
 * stronger than it is. Splitting the module into lite and browser halves is the
 * real fix and belongs with #940's build work, where the entry graphs get
 * enforced rather than documented.
 *
 * **This contract is by convention, not by compiler enforcement.** Main's
 * `lib: ["ES2024"]` does *not* currently make `Document`/`HTMLElement` unresolvable
 * — some dependency already in `src/main`'s own graph pulls the DOM lib in (this
 * predates the package extraction; `@types/node` alone does not do it). So a
 * DOM-typed export added here would compile silently rather than failing main's
 * typecheck. Widening this entry therefore requires reading the addition's import
 * graph yourself. The fix for a violation is always to prune that graph, never to
 * widen main's `lib`.
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

// MathJax lite-adaptor factory (equation rendering, server-side export).
//
// `createBrowserAdaptorDocument` / `BrowserMathJaxInstance` are deliberately NOT
// re-exported here: they are typed over `Document` and `HTMLElement`, which would
// contradict this entry's DOM-free contract. Their only consumer is
// `EquationComponent.tsx` inside the package, which imports them directly.
export { createLiteAdaptorDocument, TEX_PACKAGES } from './mathjax-config'
export type { TeXPackage, MathDocument, LiteMathJaxInstance } from './mathjax-config'

// File-type detection, used by both the mdast mapper and app-side callers
export { getFileType } from './utils/file-types'
export type { FileType } from './utils/file-types'

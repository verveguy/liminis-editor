/**
 * `@liminis/editor` — the curated public entry point.
 *
 * Consumers import from here (or from one of the other three declared
 * subpaths: `./headless`, `./contract`, `./styles.css`) and never from a deep
 * path into package internals (FR-002 / SC-002). If a consumer needs something
 * that is not exported here, the answer is to add a considered export — never a
 * deep import, and never a re-exported internals barrel.
 */

// --- Host seam -------------------------------------------------------------
// Injected services are how the package reaches its embedding environment.
export { EditorHostProvider, useEditorHost } from './host/context'
export type { EditorHostProviderProps } from './host/context'
export {
  resolveHostServices,
  defaultLoggerFactory,
  defaultNotifyError,
  noopBridge,
} from './host/defaults'
export { createHostMessageApi, useHostMessages } from './host/messages'
export type { HostMessageApi } from './host/messages'
export type {
  CorrectionHostServices,
  EditorHostBridge,
  EditorHostServices,
  EditorLogger,
  EditorLoggerFactory,
  ResolvedEditorHostServices,
} from './host/types'

// --- Components ------------------------------------------------------------
export { App } from './app/App'
export type { CursorState } from './app/App'
export { Editor } from './app/editor'
export type { SweepFn } from './app/editor/AmbientCorrectionPlugin'
export type { SelectionContextMenuEvent } from './app/editor/SelectionContextMenuPlugin'

// --- Document outline (issue #69, markdown-derived path issue #84) --------
// `createDocumentOutlineHandle()` makes the controller shared between one
// `<Editor documentOutlineHandle={…}>` and one `<DocumentOutline handle={…}>`
// — create it once per editor instance and pass the same object to both.
// A host with no mounted Lexical editor (e.g. a raw markdown mode) can feed
// the same handle from markdown text alone via `handle.publishFromMarkdown`/
// `handle.setActiveLine`; `deriveOutlineFromMarkdown`/
// `resolveActiveOutlineIndex` are exported standalone for a host that wants
// the pure derivation without going through the handle.
export { DocumentOutline } from './app/editor/DocumentOutline'
export type { DocumentOutlineProps } from './app/editor/DocumentOutline'
export { createDocumentOutlineHandle } from './app/editor/documentOutlineHandle'
export type {
  DocumentOutlineHandle,
  DocumentOutlineSnapshot,
  OutlineEntry,
} from './app/editor/documentOutlineHandle'
export { deriveOutlineFromMarkdown, resolveActiveOutlineIndex } from './app/editor/documentOutlineMarkdown'

// --- Annotations, React surface (ADR-077) ---------------------------------
// The kind-configuration types a host needs to turn the mechanism on, plus the
// create-event shape. The DOM-free anchor model, resolver and marker-target
// helpers live on the `./annotations` subpath instead, so they stay callable
// outside a rendered editor.
export { OPEN_ANNOTATION_COMPOSER_COMMAND } from './app/editor/annotationCommands'
export type { AnnotationCreateEvent } from './app/editor/AnnotationPlugin'
export type {
  Annotation,
  AnnotationKind,
  AnnotationKindConfig,
  AnnotationKindConfigs,
  AnnotationCreateAffordance,
  AnnotationMarkerStyle,
  AnnotationPresentation,
  AnnotationEditorHandle,
  MarkerTarget,
} from './annotations/types'

// --- Markdown pipeline -----------------------------------------------------
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
export { stringifyMarkdown } from './markdown/stringify'
export type { StringifyOptions } from './markdown/stringify'
export { importMarkdownToLexical, exportLexicalToMdast } from './app/mapper'
export type { ExportOptions, WikiLinkPromotionMode } from './app/mapper'

// --- Host message contract -------------------------------------------------
export * from './types'

// --- Editor-owned stores ---------------------------------------------------
// `useEditorStore` is public: `EditorColumn` drives the frontmatter tray from
// the app toolbar.
//
// `useCorrectionStore` is deliberately NOT exported. ADR-075 justifies keeping
// it package-side on the grounds that it has no consumer outside the two
// editor plugins; publishing it would invite exactly the app-side consumer that
// invalidates that reasoning, with nothing at the boundary to catch it.
export { useEditorStore } from './stores/editorStore'

// --- Utilities the host also needs ----------------------------------------
export { findSvgElement } from './app/editor/nodes/diagram-utils'

// --- DOM-free surface, re-exported for renderer-side convenience ----------
// Renderer consumers may import these from here; the Electron main process must
// use '@liminis/editor/headless' instead (it has no DOM libs).
//
// NOTE: `./headless` also exports a `ParseResult` (the C4 parser's `{diagram,
// errors}`), which this entry's explicit markdown `ParseResult` above shadows —
// explicit exports win over `export *` in both ES and TypeScript. The C4 shape is
// therefore reachable from here only under the alias below. `./headless` itself
// exports it unaliased, where there is no collision.
export * from './headless'
export type {
  ParseResult as C4ParseResult,
  ParseError as C4ParseError,
} from './app/editor/c4/types'

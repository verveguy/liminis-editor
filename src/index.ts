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

// --- Host message contract -------------------------------------------------
export * from './types'

// --- Editor-owned stores ---------------------------------------------------
export { useEditorStore } from './stores/editorStore'
export { useCorrectionStore } from './stores/correctionStore'

// --- Utilities the host also needs ----------------------------------------
export { findSvgElement } from './app/editor/nodes/diagram-utils'

// --- DOM-free surface, re-exported for renderer-side convenience ----------
// Renderer consumers may import these from here; the Electron main process must
// use '@liminis/editor/headless' instead (it has no DOM libs).
export * from './headless'

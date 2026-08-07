/**
 * Type-check probe for every public subpath (#940 / FR-002, SC-002).
 *
 * The point is not that this file does anything — it is that it *resolves*.
 * Compiled against the packed tarball, every import below has to come from the
 * emitted `.d.ts` declarations in `dist/`, never from `.ts` source. This file is
 * checked twice, under `moduleResolution: "bundler"` and `"nodenext"`, because
 * the two disagree about whether a relative specifier needs a file extension —
 * and only `nodenext` catches an emit that forgot them.
 *
 * No JSX here on purpose: `nodenext` type-checking of this file must not depend
 * on a JSX runtime being configured.
 */

// --- `.` — the root barrel ---------------------------------------------------
import {
  Editor,
  App,
  EditorHostProvider,
  useEditorHost,
  resolveHostServices,
  createHostMessageApi,
  parseMarkdown as parseFromRoot,
  stringifyMarkdown,
  importMarkdownToLexical,
  exportLexicalToMdast,
  useEditorStore,
  OPEN_ANNOTATION_COMPOSER_COMMAND,
} from '@liminis/editor'
import type {
  EditorHostServices,
  EditorLogger,
  AnnotationKindConfigs,
  AnnotationCreateEvent,
  CursorState,
} from '@liminis/editor'

// --- `./markdown` — pure mdast, no Lexical/React/MathJax ---------------------
import {
  parseMarkdown,
  isHeading,
  isText,
  getFileType,
  wikiLinkFromMarkdown,
  wikiLinkToMarkdown,
} from '@liminis/editor/markdown'
import type { ParseResult, FileType } from '@liminis/editor/markdown'

// --- `./annotations` — DOM-, React- and Lexical-free -------------------------
import {
  captureAnchor,
  resolveAnchors,
  similarity,
  shouldPlaceLiveMark,
  deriveMarkerTargets,
  ANCHOR_SCHEMA,
  REATTACH_THRESHOLD,
} from '@liminis/editor/annotations'
import type { Anchor, Annotation, AnchorOutcome } from '@liminis/editor/annotations'

// --- `./headless` — DOM-free ------------------------------------------------
import { parseC4, layoutC4Diagram, createLiteAdaptorDocument } from '@liminis/editor/headless'
import type { C4Diagram, LayoutResult } from '@liminis/editor/headless'

// --- `./contract` — types only. A *value* import here would pull in zod, -----
//     which is the one thing this entry exists to keep out of a preload bundle.
import type { HostToUIMessage, UIToHostMessage } from '@liminis/editor/contract'

// --- `./nodes` — the headless mapper surface (#954): Lexical node classes ---
//     plus the mapper functions, for a consumer building its own `createEditor`.
import {
  editorNodes,
  importMarkdownToLexical as importMarkdownToLexicalFromNodes,
  exportLexicalToMdast as exportLexicalToMdastFromNodes,
} from '@liminis/editor/nodes'

// Reference everything so `noUnusedLocals` proves each import actually resolved
// to a real exported binding rather than to `any`.
export const values = {
  Editor,
  App,
  EditorHostProvider,
  useEditorHost,
  resolveHostServices,
  createHostMessageApi,
  parseFromRoot,
  stringifyMarkdown,
  importMarkdownToLexical,
  exportLexicalToMdast,
  useEditorStore,
  OPEN_ANNOTATION_COMPOSER_COMMAND,
  parseMarkdown,
  isHeading,
  isText,
  getFileType,
  wikiLinkFromMarkdown,
  wikiLinkToMarkdown,
  captureAnchor,
  resolveAnchors,
  similarity,
  shouldPlaceLiveMark,
  deriveMarkerTargets,
  ANCHOR_SCHEMA,
  REATTACH_THRESHOLD,
  parseC4,
  layoutC4Diagram,
  createLiteAdaptorDocument,
  editorNodes,
  importMarkdownToLexicalFromNodes,
  exportLexicalToMdastFromNodes,
}

export type Types = {
  hostServices: EditorHostServices
  logger: EditorLogger
  kinds: AnnotationKindConfigs
  createEvent: AnnotationCreateEvent
  cursor: CursorState
  parseResult: ParseResult
  fileType: FileType
  anchor: Anchor
  annotation: Annotation
  outcome: AnchorOutcome
  diagram: C4Diagram
  layout: LayoutResult
  toUi: HostToUIMessage
  fromUi: UIToHostMessage
}

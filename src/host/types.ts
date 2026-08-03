/**
 * The host seam for `@liminis/editor`.
 *
 * The package boundary is drawn at **persistence**: anything about text ranges,
 * marks, rendering and in-document UX lives in this package; storage, lifecycle,
 * identity and higher-level panels live in the embedding application. Everything
 * the package needs from its host crosses that seam through the interfaces below
 * (see ADR-075).
 *
 * Every member is optional and has a safe default (see `./defaults.ts`), so
 * `<Editor>` renders in a host that supplies nothing at all.
 */

import type { HostToUIMessage, UIToHostMessage } from '../types'

/** Minimal logging surface. Structurally compatible with liminis-app's `Logger`. */
export interface EditorLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/** Factory producing a namespaced logger, e.g. `createLogger('slashmd/App')`. */
export type EditorLoggerFactory = (namespace: string) => EditorLogger

/**
 * The channel through which the package talks to its embedding environment.
 *
 * Deliberately two methods: all higher-level helpers (`requestInit`,
 * `applyTextEdits`, `writeAsset`, `openLink`) are built on `postMessage`
 * inside the package, so every host adapter emits byte-identical payloads.
 */
export interface EditorHostBridge {
  postMessage(message: UIToHostMessage): void
  /** Subscribe to host → UI messages. Returns an unsubscribe function. */
  addMessageHandler(handler: (message: HostToUIMessage) => void): () => void
}

/**
 * Persistence and knowledge-graph services backing the correction feature.
 *
 * The in-editor correction UI is package-side; reading and writing
 * `.liminis/knowledge-corrections.yaml` and driving the MCP knowledge tools
 * stays host-side (FR-006, and see ADR-057).
 */
export interface CorrectionHostServices {
  /** Raw YAML text of the corrections file, or `null` when it does not exist. */
  readCorrections(): Promise<string | null>
  /** Persist the corrections file. The host owns mkdir and atomic-write semantics. */
  writeCorrections(yaml: string): Promise<void>
  /** Entity-name suggestions for an autocomplete query. */
  suggestEntities(query: string, numResults: number): Promise<string[]>
  /** Passage/source-name suggestions for an autocomplete query. */
  suggestPassages(query: string, numResults: number, minScore: number): Promise<string[]>
  /** Apply pending corrections to the knowledge graph. Resolves true on success. */
  applyCorrections(): Promise<boolean>
}

/** Everything the package may ask of its host. */
export interface EditorHostServices {
  /** Host message channel (Electron IPC in liminis-app). */
  bridge?: EditorHostBridge
  /** Namespaced logger factory. */
  logger?: EditorLoggerFactory
  /**
   * Resolve wiki-link targets to existing paths. Returns a map of target →
   * resolved path, or `null` for targets that do not resolve.
   */
  resolveWikiLinks?: (targets: string[]) => Promise<Record<string, string | null>>
  /** Subscribe to host-driven "scroll to this anchor" requests. */
  onScrollToAnchor?: (callback: (anchor: string) => void) => () => void
  /** Surface a user-visible error (a toast in liminis-app). */
  notifyError?: (message: string, description?: string) => void
  /** Correction persistence + knowledge-graph services. */
  corrections?: CorrectionHostServices
}

/** `EditorHostServices` with every member resolved to a concrete implementation. */
export type ResolvedEditorHostServices = Required<
  Pick<EditorHostServices, 'bridge' | 'logger' | 'notifyError'>
> &
  Pick<EditorHostServices, 'resolveWikiLinks' | 'onScrollToAnchor' | 'corrections'>

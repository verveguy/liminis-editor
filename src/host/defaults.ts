/**
 * Safe defaults for every host service.
 *
 * FR-003 / US2-AC2: a host that supplies no logger, no bridge and no resolvers
 * must still get a working `<Editor>`. Nothing here throws, and nothing here
 * touches a global that only exists inside Electron.
 */

import type {
  EditorHostBridge,
  EditorHostServices,
  EditorLogger,
  EditorLoggerFactory,
  ResolvedEditorHostServices,
} from './types'

/** Console-backed logger namespaced the same way liminis-app's logger is. */
export const defaultLoggerFactory: EditorLoggerFactory = (namespace: string): EditorLogger => ({
  debug: (...args: unknown[]) => console.debug(`[${namespace}]`, ...args),
  info: (...args: unknown[]) => console.info(`[${namespace}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${namespace}]`, ...args),
  error: (...args: unknown[]) => console.error(`[${namespace}]`, ...args),
})

/**
 * Bridge that drops outbound messages and never delivers inbound ones.
 *
 * This is the correct standalone behaviour: with no host there is nothing to
 * apply edits to, so the editor simply behaves as an uncontrolled component.
 */
export const noopBridge: EditorHostBridge = {
  postMessage: () => {},
  addMessageHandler: () => () => {},
}

/** Last-resort error surface when the host provides no toast mechanism. */
export const defaultNotifyError = (message: string, description?: string): void => {
  if (description) {
    console.error(message, description)
  } else {
    console.error(message)
  }
}

/** Fill in every unsupplied service with its safe default. */
export function resolveHostServices(
  services: EditorHostServices | undefined
): ResolvedEditorHostServices {
  return {
    bridge: services?.bridge ?? noopBridge,
    logger: services?.logger ?? defaultLoggerFactory,
    notifyError: services?.notifyError ?? defaultNotifyError,
    // Left undefined on purpose when absent: the plugins that use these treat
    // "service missing" as "feature unavailable, do nothing" — exactly what the
    // pre-extraction host-API presence guards did.
    resolveWikiLinks: services?.resolveWikiLinks,
    onScrollToAnchor: services?.onScrollToAnchor,
    corrections: services?.corrections,
  }
}

/**
 * Host message helpers, rebuilt on top of `EditorHostBridge.postMessage`.
 *
 * These used to live in `liminis-app/src/editor/messaging-electron.ts`. Keeping
 * them package-side means every host adapter only has to implement
 * `postMessage` + `addMessageHandler`, and the wire payloads are identical by
 * construction rather than by convention.
 */

import { useMemo } from 'react'
import type { TextEdit, UIToHostMessage } from '../types'
import { useEditorHost } from './context'
import type { EditorHostBridge, EditorLogger, EditorLoggerFactory } from './types'

/**
 * Members are declared as function-typed properties rather than methods on
 * purpose: callers destructure them (`const { openLink } = useHostMessages()`),
 * which the `unbound-method` lint rule rightly flags for real methods.
 */
export interface HostMessageApi {
  postMessage: (message: UIToHostMessage) => void
  requestInit: () => void
  requestSettings: () => void
  applyTextEdits: (edits: TextEdit[], reason: 'typing' | 'drag' | 'paste' | 'format') => void
  writeAsset: (dataUri: string, suggestedName?: string) => void
  openLink: (url: string) => void
}

export function createHostMessageApi(bridge: EditorHostBridge, log: EditorLogger): HostMessageApi {
  const postMessage = (message: UIToHostMessage): void => {
    bridge.postMessage(message)
  }

  return {
    postMessage,

    requestInit: () => {
      log.info('Requesting init from host')
      postMessage({ type: 'REQUEST_INIT' })
    },

    requestSettings: () => {
      postMessage({ type: 'REQUEST_SETTINGS' })
    },

    applyTextEdits: (edits, reason) => {
      log.debug('applyTextEdits', {
        reason,
        edits: edits.map((e) => ({ start: e.start, end: e.end, newTextLen: e.newText.length })),
      })
      postMessage({ type: 'APPLY_TEXT_EDITS', edits, reason })
    },

    writeAsset: (dataUri, suggestedName) => {
      postMessage({ type: 'WRITE_ASSET', dataUri, suggestedName })
    },

    openLink: (url) => {
      log.debug('openLink', { url })
      postMessage({ type: 'OPEN_LINK', url })
    },
  }
}

/** Hook form of {@link createHostMessageApi}, bound to the ambient host services. */
export function useHostMessages(): HostMessageApi {
  const { bridge, logger } = useEditorHost()
  return useMemo(() => createHostMessageApi(bridge, makeLog(logger)), [bridge, logger])
}

function makeLog(logger: EditorLoggerFactory): EditorLogger {
  return logger('slashmd/messaging')
}

import { describe, expect, it, vi } from 'vitest'
import { createHostMessageApi } from '../messages'
import type { EditorHostBridge, EditorLogger } from '../types'

function stubBridge() {
  const posted: unknown[] = []
  const bridge: EditorHostBridge = {
    postMessage: (message) => posted.push(message),
    addMessageHandler: () => () => {},
  }
  return { bridge, posted }
}

const silentLog: EditorLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('createHostMessageApi', () => {
  it('emits the same payloads the pre-extraction electron adapter did', () => {
    const { bridge, posted } = stubBridge()
    const api = createHostMessageApi(bridge, silentLog)

    api.requestInit()
    api.requestSettings()
    api.applyTextEdits([{ start: 0, end: 3, newText: 'abc' }], 'typing')
    api.writeAsset('data:image/png;base64,AAA', 'pasted.png')
    api.writeAsset('data:image/png;base64,BBB')
    api.openLink('https://example.com')

    expect(posted).toEqual([
      { type: 'REQUEST_INIT' },
      { type: 'REQUEST_SETTINGS' },
      {
        type: 'APPLY_TEXT_EDITS',
        edits: [{ start: 0, end: 3, newText: 'abc' }],
        reason: 'typing',
      },
      { type: 'WRITE_ASSET', dataUri: 'data:image/png;base64,AAA', suggestedName: 'pasted.png' },
      { type: 'WRITE_ASSET', dataUri: 'data:image/png;base64,BBB', suggestedName: undefined },
      { type: 'OPEN_LINK', url: 'https://example.com' },
    ])
  })

  it('is inert over the no-op bridge rather than throwing', () => {
    const api = createHostMessageApi(
      { postMessage: () => {}, addMessageHandler: () => () => {} },
      silentLog
    )
    expect(() => api.requestInit()).not.toThrow()
    expect(() => api.openLink('https://example.com')).not.toThrow()
  })
})

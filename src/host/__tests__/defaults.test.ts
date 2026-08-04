import { describe, expect, it, vi } from 'vitest'
import {
  defaultLoggerFactory,
  defaultNotifyError,
  noopBridge,
  resolveHostServices,
} from '../defaults'
import type { EditorHostServices } from '../types'

describe('host service defaults', () => {
  it('resolves every required service when the host supplies nothing', () => {
    const resolved = resolveHostServices(undefined)
    expect(resolved.bridge).toBe(noopBridge)
    expect(resolved.logger).toBe(defaultLoggerFactory)
    expect(resolved.notifyError).toBe(defaultNotifyError)
  })

  it('leaves optional capability services undefined so plugins can no-op', () => {
    const resolved = resolveHostServices({})
    expect(resolved.resolveWikiLinks).toBeUndefined()
    expect(resolved.onScrollToAnchor).toBeUndefined()
    expect(resolved.corrections).toBeUndefined()
  })

  it('never throws when the default bridge is exercised', () => {
    expect(() => noopBridge.postMessage({ type: 'REQUEST_INIT' })).not.toThrow()
    const unsubscribe = noopBridge.addMessageHandler(() => {
      throw new Error('the no-op bridge must never deliver a message')
    })
    expect(() => unsubscribe()).not.toThrow()
  })

  it('never throws from the default logger', () => {
    const spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    }
    const log = defaultLoggerFactory('pkg/test')
    expect(() => {
      log.debug('d')
      log.info('i')
      log.warn('w')
      log.error('e')
    }).not.toThrow()
    expect(spies.debug).toHaveBeenCalledWith('[pkg/test]', 'd')
    expect(spies.error).toHaveBeenCalledWith('[pkg/test]', 'e')
    for (const spy of Object.values(spies)) spy.mockRestore()
  })

  it('never throws from the default error notifier', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => defaultNotifyError('boom')).not.toThrow()
    expect(() => defaultNotifyError('boom', 'details')).not.toThrow()
    expect(spy).toHaveBeenCalledWith('boom', 'details')
    spy.mockRestore()
  })

  it('prefers host-supplied services over defaults', () => {
    const services: EditorHostServices = {
      bridge: { postMessage: vi.fn(), addMessageHandler: vi.fn(() => () => {}) },
      logger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
      notifyError: vi.fn(),
      resolveWikiLinks: vi.fn(async () => ({})),
      onScrollToAnchor: vi.fn(() => () => {}),
    }
    const resolved = resolveHostServices(services)
    expect(resolved.bridge).toBe(services.bridge)
    expect(resolved.logger).toBe(services.logger)
    expect(resolved.notifyError).toBe(services.notifyError)
    expect(resolved.resolveWikiLinks).toBe(services.resolveWikiLinks)
    expect(resolved.onScrollToAnchor).toBe(services.onScrollToAnchor)
  })
})

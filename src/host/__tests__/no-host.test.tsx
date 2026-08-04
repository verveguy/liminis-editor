/**
 * US2-AC2 / the spec's Independent Test for User Story 2: instantiate the editor
 * with no host services supplied and confirm it renders.
 *
 * This is the acceptance scenario for FR-003's "safe default" requirement, and it
 * is the only check that would catch a plugin regaining a hard host dependency —
 * a `window.api` reach-in reintroduced inside a plugin body would throw here while
 * the SC-004 grep stayed green (the grep only sees the literal text).
 */

import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { Editor } from '../../app/editor'
import { App } from '../../app/App'
import { EditorHostProvider } from '../context'

const MARKDOWN = ['# Heading', '', 'Some *text* with a [[wiki-link]].', '', '- item'].join('\n')

async function renderQuiet(ui: ReactElement): Promise<{ html: string; errors: unknown[][] }> {
  const errors: unknown[][] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args)
  })
  try {
    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(ui))
    })
    return { html: container.innerHTML, errors }
  } finally {
    spy.mockRestore()
    cleanup()
  }
}

describe('rendering without any host services', () => {
  it('mounts <Editor> with no provider at all', async () => {
    const { html, errors } = await renderQuiet(
      <Editor initialContent={MARKDOWN} onChange={() => {}} />
    )
    expect(errors).toEqual([])
    expect(html).toContain('Heading')
  })

  it('mounts <Editor> under a provider that supplies nothing', async () => {
    const { html, errors } = await renderQuiet(
      <EditorHostProvider>
        <Editor initialContent={MARKDOWN} onChange={() => {}} />
      </EditorHostProvider>
    )
    expect(errors).toEqual([])
    expect(html).toContain('Heading')
  })

  it('mounts the outer <App> with no host, driving the no-op bridge', async () => {
    const { html, errors } = await renderQuiet(
      <EditorHostProvider services={{}}>
        <App content={MARKDOWN} onChange={() => {}} />
      </EditorHostProvider>
    )
    // The no-op bridge swallows REQUEST_INIT and never delivers DOC_INIT, so the
    // inline `content` prop is what must reach the document.
    expect(errors).toEqual([])
    expect(html).toContain('Heading')
  })
})

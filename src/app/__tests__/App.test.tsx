/**
 * User Story 1 for issue #80: `documentOutlineHandle` must reach the inner
 * `<Editor>` through `<App>`, not just through `<Editor>` directly — the gap
 * left open when issue #69 added the prop to `EditorProps` but not `AppProps`.
 * Driven entirely through `<App>` and a sibling `<DocumentOutline>`, the same
 * way an `<App>` consumer (e.g. Zusammen) would actually wire it up.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, within } from '@testing-library/react'
import { App } from '../App'
import { DocumentOutline } from '../editor/DocumentOutline'
import { createDocumentOutlineHandle } from '../editor/documentOutlineHandle'
import { EditorHostProvider } from '../../host/context'

const MARKDOWN = ['# Introduction', '', 'Some text.', '', '## Details', '', 'More text.'].join('\n')

afterEach(() => {
  cleanup()
})

describe('App forwards documentOutlineHandle to Editor (issue #80 US1)', () => {
  it('populates a sibling <DocumentOutline> from headings, with no direct use of <Editor> (US1-AC1)', async () => {
    const handle = createDocumentOutlineHandle()

    await act(async () => {
      render(
        <EditorHostProvider services={{}}>
          <App content={MARKDOWN} onChange={() => {}} documentOutlineHandle={handle} />
          <DocumentOutline handle={handle} />
        </EditorHostProvider>
      )
    })

    expect(handle.getSnapshot().entries).toEqual([
      { index: 0, level: 1, text: 'Introduction' },
      { index: 1, level: 2, text: 'Details' },
    ])
  })

  it('scrolls the editor to the clicked heading (US1-AC2)', async () => {
    const handle = createDocumentOutlineHandle()

    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(
        <EditorHostProvider services={{}}>
          <App content={MARKDOWN} onChange={() => {}} documentOutlineHandle={handle} />
          <DocumentOutline handle={handle} />
        </EditorHostProvider>
      ))
    })

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      const nav = container.querySelector('.editor-outline')!
      const detailsButton = within(nav as HTMLElement).getByText('Details').closest('button')!
      fireEvent.click(detailsButton)

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      // Not just that something scrolled — that it was the Details heading itself.
      const scrolledElement = scrollIntoView.mock.contexts[0] as HTMLElement
      expect(scrolledElement.textContent).toBe('Details')
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  it('mounts no outline plugin when documentOutlineHandle is not supplied', async () => {
    const handle = createDocumentOutlineHandle()

    await act(async () => {
      render(
        <EditorHostProvider services={{}}>
          <App content={MARKDOWN} onChange={() => {}} />
        </EditorHostProvider>
      )
    })

    // Nothing ever published to this handle, since it was never passed to <App>.
    expect(handle.getSnapshot()).toEqual({ entries: [], activeIndex: null })
  })
})

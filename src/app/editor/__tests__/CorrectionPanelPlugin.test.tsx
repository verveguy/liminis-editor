/**
 * End-to-end cover for the heaviest inversion in the extraction: the seven
 * `window.api` call sites in `CorrectionPanelPlugin` that became
 * `CorrectionHostServices` (FR-006, SC-005).
 *
 * Two properties of the pre-extraction code are load-bearing and are asserted
 * here rather than left to a manual click-through:
 *
 *  - **Call ordering.** `suggestEntities` must be awaited *before*
 *    `suggestPassages` — the MCP stdio invoker rejects concurrent calls to one
 *    server (ADR-042). Parallelising them would still render correctly.
 *  - **Re-read before write.** Confirm re-reads the corrections document, merges
 *    into *that*, and writes the merge, so a correction added elsewhere while the
 *    panel was open is not clobbered.
 *
 * The absent-service case is covered too: with no `corrections` service the panel
 * still opens and confirm performs only the in-document replacement.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical'
import { EditorHostProvider } from '../../../host/context'
import type { CorrectionHostServices, EditorHostServices } from '../../../host/types'
import { useCorrectionStore } from '../../../stores/correctionStore'
import { CorrectionPanelPlugin } from '../CorrectionPanelPlugin'
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils'

const EXISTING_YAML = [
  'corrections:',
  '  - type: same_as',
  '    canonical: Ada Lovelace',
  '    aliases:',
  '      - Ada L.',
].join('\n')

/**
 * A stub host recording every call, with the call order preserved.
 *
 * The mocks are returned as standalone consts rather than read back off the
 * service object, so assertions never reference an unbound method.
 */
function makeCorrectionsStub(overrides: Partial<CorrectionHostServices> = {}) {
  const order: string[] = []
  const written: string[] = []

  const readCorrections = vi.fn(async (): Promise<string | null> => {
    order.push('read')
    return EXISTING_YAML
  })
  const writeCorrections = vi.fn(async (yaml: string): Promise<void> => {
    order.push('write')
    written.push(yaml)
  })
  const suggestEntities = vi.fn(async (): Promise<string[]> => {
    order.push('entities')
    return ['Ada Lovelace']
  })
  const suggestPassages = vi.fn(async (): Promise<string[]> => {
    order.push('passages')
    return ['Notes on the Analytical Engine']
  })
  const applyCorrections = vi.fn(async (): Promise<boolean> => {
    order.push('apply')
    return true
  })

  const mocks = {
    readCorrections,
    writeCorrections,
    suggestEntities,
    suggestPassages,
    applyCorrections,
    ...overrides,
  }
  const stub: CorrectionHostServices = { ...mocks }
  return { stub, mocks, order, written }
}

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])
  return null
}

async function mountPanel(services: EditorHostServices): Promise<LexicalEditor> {
  let editor: LexicalEditor | null = null
  await act(async () => {
    render(
      <EditorHostProvider services={services}>
        <LexicalComposer
          initialConfig={{
            namespace: 'correction-panel-test',
            nodes: editorNodes,
            onError: (e) => {
              throw e
            },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable />}
            placeholder={null}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <CaptureEditor
            onReady={(e) => {
              editor = e
            }}
          />
          <CorrectionPanelPlugin />
        </LexicalComposer>
      </EditorHostProvider>
    )
  })
  await act(async () => {
    editor!.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('Ada L. wrote the first program. Ada L. is remembered.'))
      $getRoot().clear().append(paragraph)
    })
  })
  return editor!
}

/** Open the panel the way SelectionContextMenuPlugin does. */
async function openPanel(selectedText: string): Promise<void> {
  await act(async () => {
    useCorrectionStore.getState().open({ x: 10, y: 10 }, selectedText)
  })
}

async function typeCanonical(value: string): Promise<void> {
  const input = screen.getByPlaceholderText('Enter correct name…')
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
}

async function clickButton(label: string): Promise<void> {
  const button = screen.getByText(label)
  await act(async () => {
    fireEvent.click(button)
  })
}

afterEach(() => {
  cleanup()
  act(() => {
    useCorrectionStore.getState().close()
  })
  vi.clearAllMocks()
})

describe('CorrectionPanelPlugin over injected CorrectionHostServices', () => {
  it('renders nothing until the store opens it', async () => {
    const { stub, mocks } = makeCorrectionsStub()
    await mountPanel({ corrections: stub })
    expect(screen.queryByPlaceholderText('Enter correct name…')).toBeNull()
    expect(mocks.readCorrections).not.toHaveBeenCalled()
  })

  it('drives the full open → suggest → confirm → apply cycle through the host', async () => {
    const { stub, mocks, order, written } = makeCorrectionsStub()
    const notifyError = vi.fn()
    await mountPanel({ corrections: stub, notifyError })

    // --- open: suggestions load from all three sources
    await openPanel('Ada L.')
    await waitFor(() => expect(mocks.suggestPassages).toHaveBeenCalled())

    expect(mocks.readCorrections).toHaveBeenCalled()
    expect(mocks.suggestEntities).toHaveBeenCalledWith('Ada L.', 5)
    expect(mocks.suggestPassages).toHaveBeenCalledWith('Ada L.', 5, 0.3)
    expect(order.indexOf('entities')).toBeLessThan(order.indexOf('passages'))
    // The YAML alias match is surfaced as a suggestion.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Notes on the Analytical Engine')).toBeTruthy()

    // --- confirm
    await typeCanonical('Ada Lovelace')
    await clickButton('Confirm')
    await waitFor(() => expect(mocks.applyCorrections).toHaveBeenCalledTimes(1))

    // Confirm re-reads before writing so a concurrent edit is not clobbered, and
    // applies only after a successful write.
    const writeIndex = order.indexOf('write')
    expect(order.lastIndexOf('read')).toBeLessThan(writeIndex)
    expect(writeIndex).toBeLessThan(order.indexOf('apply'))

    expect(written).toHaveLength(1)
    expect(written[0]).toContain('Ada Lovelace')
    expect(written[0]).toContain('Ada L.')

    expect(notifyError).not.toHaveBeenCalled()
    // The panel closes only after a successful write.
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter correct name…')).toBeNull())
  })

  it('does not start the passage lookup until the entity lookup has resolved (ADR-042)', async () => {
    // A pending suggestEntities is the only way to distinguish "awaited in
    // sequence" from "both kicked off, results ordered by chance". The MCP stdio
    // invoker rejects a second concurrent call to the same server, so this is the
    // property that matters, not the order the results happen to arrive in.
    let releaseEntities!: (names: string[]) => void
    const { stub, mocks } = makeCorrectionsStub({
      suggestEntities: vi.fn(
        () => new Promise<string[]>((resolve) => (releaseEntities = resolve))
      ),
    })
    await mountPanel({ corrections: stub })

    await openPanel('Ada L.')
    await waitFor(() => expect(mocks.suggestEntities).toHaveBeenCalled())
    expect(mocks.suggestPassages).not.toHaveBeenCalled()

    await act(async () => {
      releaseEntities(['Ada Lovelace'])
    })
    await waitFor(() => expect(mocks.suggestPassages).toHaveBeenCalledTimes(1))
  })

  it('surfaces a write failure through notifyError and keeps the panel open', async () => {
    const { stub, mocks } = makeCorrectionsStub({
      writeCorrections: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    const notifyError = vi.fn()
    await mountPanel({ corrections: stub, notifyError })

    await openPanel('Ada L.')
    await waitFor(() => expect(mocks.suggestPassages).toHaveBeenCalled())
    await typeCanonical('Ada Lovelace')
    await clickButton('Confirm')

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('Failed to save correction', 'disk full')
    )
    // A failed write must not reach the knowledge graph, and must not close.
    expect(mocks.applyCorrections).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Enter correct name…')).not.toBeNull()
  })

  it('warns but does not block when the knowledge-graph sync fails', async () => {
    const { stub, mocks } = makeCorrectionsStub({ applyCorrections: vi.fn(async () => false) })
    const notifyError = vi.fn()
    await mountPanel({ corrections: stub, notifyError })

    await openPanel('Ada L.')
    await waitFor(() => expect(mocks.suggestPassages).toHaveBeenCalled())
    await typeCanonical('Ada Lovelace')
    await clickButton('Confirm')

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        'Knowledge graph sync failed',
        'The correction was saved. It will be applied on the next ingestion pass.'
      )
    )
    // The correction was saved, so the panel still closes.
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter correct name…')).toBeNull())
  })

  it('still opens and replaces in-document when the host offers no correction services', async () => {
    const editor = await mountPanel({})

    // A bare word, so the plugin's word-boundary-anchored replace-all matches.
    await openPanel('Ada')
    expect(screen.getByPlaceholderText('Enter correct name…')).toBeTruthy()

    await typeCanonical('Augusta')
    // Replace-all is the only thing the package can do unaided.
    const checkbox = screen.getByRole('checkbox')
    await act(async () => {
      fireEvent.click(checkbox)
    })
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    await clickButton('Confirm')

    await waitFor(() => expect(screen.queryByPlaceholderText('Enter correct name…')).toBeNull())
    const text = editor.getEditorState().read(() => $getRoot().getTextContent())
    expect(text).toBe('Augusta L. wrote the first program. Augusta L. is remembered.')
  })
})

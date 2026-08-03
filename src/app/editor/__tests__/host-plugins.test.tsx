/**
 * Coverage for the two `window.api` reach-ins inverted in this extraction
 * (FR-003, US2-AC3): `AnchorScrollPlugin` → `onScrollToAnchor` and
 * `WikiLinkExistencePlugin` → `resolveWikiLinks`.
 *
 * Both cases matter. The *present* case proves the injected service is actually
 * wired through and still drives the same DOM effect it did pre-extraction; the
 * *absent* case proves the plugin no-ops rather than throwing, which is what the
 * old `if (!window.api?…) return` guards did and what FR-003's "safe default"
 * requires of a host that supplies nothing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical'
import { $createHeadingNode } from '@lexical/rich-text'
import { EditorHostProvider } from '../../../host/context'
import type { EditorHostServices } from '../../../host/types'
import { $createCustomLinkNode } from '../nodes'
import { AnchorScrollPlugin } from '../AnchorScrollPlugin'
import { WikiLinkExistencePlugin } from '../WikiLinkExistencePlugin'
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils'

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])
  return null
}

/** Mount a plugin inside a real Lexical editor under the given host services. */
async function mountPlugin(
  services: EditorHostServices,
  plugin: React.ReactNode
): Promise<{ editor: LexicalEditor; container: HTMLElement }> {
  let editor: LexicalEditor | null = null
  let container!: HTMLElement
  await act(async () => {
    ;({ container } = render(
      <EditorHostProvider services={services}>
        <LexicalComposer
          initialConfig={{
            namespace: 'host-plugin-test',
            nodes: editorNodes,
            theme: { heading: { h1: 'editor-heading-h1', h2: 'editor-heading-h2' } },
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
          {plugin}
        </LexicalComposer>
      </EditorHostProvider>
    ))
  })
  return { editor: editor!, container }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AnchorScrollPlugin over the injected onScrollToAnchor service', () => {
  it('scrolls the container to the matching heading when the host supplies the service', async () => {
    let emit: ((anchor: string) => void) | null = null
    const unsubscribe = vi.fn()
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return unsubscribe
    })

    const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)
    expect(onScrollToAnchor).toHaveBeenCalledTimes(1)

    await act(async () => {
      editor.update(() => {
        const heading = $createHeadingNode('h2')
        heading.append($createTextNode('Design Notes'))
        $getRoot().clear().append(heading)
      })
    })

    // The plugin scrolls the nearest #editor-scroll-container ancestor, which the
    // host chrome supplies in the real app. Tag the existing ancestor rather than
    // reparenting, so React still owns the tree it has to unmount.
    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo

    // Match is normalized, so casing and punctuation differences still resolve.
    act(() => emit!('design notes'))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
  })

  it('no-ops, and does not throw, when the host supplies no service', async () => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    try {
      await expect(mountPlugin({}, <AnchorScrollPlugin />)).resolves.toBeTruthy()
    } finally {
      spy.mockRestore()
    }
    expect(errors).toEqual([])
  })
})

describe('WikiLinkExistencePlugin over the injected resolveWikiLinks service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /**
   * Put two real wiki-links in the document. Going through CustomLinkNode rather
   * than appending raw anchors matters twice over: Lexical's mutation observer
   * reverts foreign DOM inserted into the contenteditable root, and the
   * `data-wiki-link` / `data-wiki-target` attributes the plugin keys off are
   * produced by the node itself, so this also pins that contract.
   */
  async function seedWikiLinks(editor: LexicalEditor): Promise<void> {
    await act(async () => {
      editor.update(() => {
        const paragraph = $createParagraphNode()
        for (const target of ['exists', 'missing']) {
          const link = $createCustomLinkNode(target)
          link.append($createTextNode(target))
          paragraph.append(link)
        }
        $getRoot().clear().append(paragraph)
      })
    })
  }

  it('marks only unresolved targets broken when the host supplies the service', async () => {
    const resolveWikiLinks = vi.fn(async (targets: string[]) =>
      Object.fromEntries(targets.map((t) => [t, t === 'exists' ? 'notes/exists.md' : null]))
    )

    const { editor } = await mountPlugin({ resolveWikiLinks }, <WikiLinkExistencePlugin />)
    await seedWikiLinks(editor)

    // The check is debounced by 300ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(resolveWikiLinks).toHaveBeenCalledWith(['exists', 'missing'])
    const root = editor.getRootElement()!
    const [existing, missing] = Array.from(root.querySelectorAll('a[data-wiki-link="true"]'))
    expect(existing.classList.contains('editor-link-broken')).toBe(false)
    expect(missing.classList.contains('editor-link-broken')).toBe(true)
  })

  it('leaves every link unmarked, and does not throw, when the host supplies no service', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { editor } = await mountPlugin({}, <WikiLinkExistencePlugin />)
      await seedWikiLinks(editor)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      const root = editor.getRootElement()!
      const links = Array.from(root.querySelectorAll('a[data-wiki-link="true"]'))
      expect(links).toHaveLength(2)
      // Critical parity point: an absent resolver must not mark links broken.
      // Defaulting the service to a stub returning {} would fail this assertion.
      for (const link of links) {
        expect(link.classList.contains('editor-link-broken')).toBe(false)
      }
      expect(error).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})

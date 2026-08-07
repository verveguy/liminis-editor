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
import { useEffect, type ReactNode } from 'react'
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
  plugin: ReactNode
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

/** Await N real animation frames, driving the plugin's rAF-based retry loop. */
async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

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

  it('resolves a GitHub-slug-form anchor against a heading containing punctuation GitHub strips', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

    await act(async () => {
      editor.update(() => {
        const heading = $createHeadingNode('h2')
        // GitHub's slugger drops backticks and dots: this heading slugs to
        // exactly "rebase-and-migration-from-envenc".
        heading.append($createTextNode('Rebase and migration from `.env.enc`'))
        $getRoot().clear().append(heading)
      })
    })

    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo

    act(() => emit!('rebase-and-migration-from-envenc'))
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('retries across animation frames until a heading rendered asynchronously appears', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo

    // Emit before the heading exists, simulating a fragment that targets a
    // heading below content (equations, diagrams, code highlighting) that
    // hasn't finished rendering yet.
    act(() => emit!('design notes'))
    expect(scrollTo).not.toHaveBeenCalled()

    await frames(3)
    expect(scrollTo).not.toHaveBeenCalled()

    await act(async () => {
      editor.update(() => {
        const heading = $createHeadingNode('h2')
        heading.append($createTextNode('Design Notes'))
        $getRoot().clear().append(heading)
      })
    })

    await frames(5)
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('gives up silently once the retry budget is exhausted for an unresolvable anchor', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

      const scroller = editor.getRootElement()!.parentElement!
      scroller.id = 'editor-scroll-container'
      const scrollTo = vi.fn()
      scroller.scrollTo = scrollTo

      act(() => emit!('nothing-matches-this-anchor'))

      // Budget is 30 retries; give it comfortably more frames than that.
      await frames(40)

      expect(scrollTo).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it('discovers a scrollable ancestor by walking up when no known container id is present', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const { editor, container } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

    await act(async () => {
      editor.update(() => {
        const heading = $createHeadingNode('h2')
        heading.append($createTextNode('Design Notes'))
        $getRoot().clear().append(heading)
      })
    })

    // No known id anywhere in the ancestor chain, so the fast path must fail
    // and the walk must be what finds this container. happy-dom doesn't
    // populate overflow/scroll metrics from layout, so stub them explicitly.
    const realGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, ...rest) =>
      el === container
        ? ({ overflowY: 'auto' } as CSSStyleDeclaration)
        : realGetComputedStyle(el, ...rest)
    )
    Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo

    act(() => emit!('design notes'))
    expect(scrollTo).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
  })

  it('positions the resolved heading near the top of the container rather than flush or via raw offsetTop', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

    await act(async () => {
      editor.update(() => {
        const heading = $createHeadingNode('h2')
        heading.append($createTextNode('Design Notes'))
        $getRoot().clear().append(heading)
      })
    })
    const selector = ['.editor-heading-h1', '.editor-heading-h2'].join(',')
    const headingEl: HTMLElement = editor.getRootElement()!.querySelector(selector)!

    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo
    scroller.scrollTop = 100
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    headingEl.getBoundingClientRect = () => ({ top: 916 }) as DOMRect

    act(() => emit!('design notes'))

    // top = heading.rect.top(916) - container.rect.top(0) + container.scrollTop(100) - MARGIN(16) = 1000
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 1000, behavior: 'smooth' })
  })

  it('does not match an anchor that normalizes to an empty string against a heading that also normalizes to empty', async () => {
    let emit: ((anchor: string) => void) | null = null
    const onScrollToAnchor = vi.fn((cb: (anchor: string) => void) => {
      emit = cb
      return vi.fn()
    })

    const { editor } = await mountPlugin({ onScrollToAnchor }, <AnchorScrollPlugin />)

    await act(async () => {
      editor.update(() => {
        // Punctuation-only heading text normalizes to the empty string.
        const heading = $createHeadingNode('h2')
        heading.append($createTextNode('!!!'))
        $getRoot().clear().append(heading)
      })
    })

    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo

    // This anchor also normalizes to the empty string.
    act(() => emit!('???'))
    await frames(3)

    expect(scrollTo).not.toHaveBeenCalled()
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

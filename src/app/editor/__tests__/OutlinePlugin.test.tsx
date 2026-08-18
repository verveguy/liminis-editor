/**
 * Coverage for OutlinePlugin (issue #69): heading derivation (FR-002),
 * live updates as the document changes (FR-005), scroll-spy activation
 * (FR-004), and scroll-to-heading (FR-003) — all driven through the
 * `DocumentOutlineHandle` a host would actually read, not through internals.
 */

import { describe, expect, it, afterEach, vi } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createTextNode, type LexicalEditor } from 'lexical'
import { $createHeadingNode } from '@lexical/rich-text'
import { OutlinePlugin } from '../OutlinePlugin'
import { createDocumentOutlineHandle, type DocumentOutlineHandle } from '../documentOutlineHandle'
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils'

const HEADING_THEME = {
  heading: {
    h1: 'editor-heading-h1',
    h2: 'editor-heading-h2',
    h3: 'editor-heading-h3',
    h4: 'editor-heading-h4',
    h5: 'editor-heading-h5',
  },
}

function CaptureEditor({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])
  return null
}

async function mount(
  handle: DocumentOutlineHandle,
  extra?: ReactNode
): Promise<{ editor: LexicalEditor; container: HTMLElement }> {
  let editor: LexicalEditor | null = null
  let container!: HTMLElement
  await act(async () => {
    ;({ container } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'outline-plugin-test',
          nodes: editorNodes,
          theme: HEADING_THEME,
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
        <OutlinePlugin handle={handle} />
        {extra}
      </LexicalComposer>
    ))
  })
  return { editor: editor!, container }
}

afterEach(() => {
  cleanup()
})

/** Await N real animation frames, driving the plugin's rAF-throttled scroll-spy. */
async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

describe('OutlinePlugin heading derivation', () => {
  it('renders no entries for a document with no headings (US1-AC3)', async () => {
    const handle = createDocumentOutlineHandle()
    await mount(handle)

    expect(handle.getSnapshot()).toEqual({ entries: [], activeIndex: null })
  })

  it('lists headings in document order, indexed and leveled, with skipped levels, duplicate titles, and inline-formatted text reduced to plain text (US1-AC1)', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor } = await mount(handle)

    await act(async () => {
      editor.update(() => {
        const root = $getRoot().clear()

        const h1 = $createHeadingNode('h1')
        h1.append($createTextNode('Introduction'))
        root.append(h1)

        // Skipped level: h1 -> h3. Text has no Markdown delimiters, so a
        // pass mistakenly matching on literal backticks rather than actually
        // reducing the code-formatted node to plain text can't accidentally
        // pass this assertion.
        const h3 = $createHeadingNode('h3')
        const code = $createTextNode('inline code').setFormat('code')
        h3.append($createTextNode('See '), code)
        root.append(h3)

        // Duplicate title, deeper nesting.
        const h2a = $createHeadingNode('h2')
        h2a.append($createTextNode('Introduction'))
        root.append(h2a)

        const h5 = $createHeadingNode('h5')
        h5.append($createTextNode('Deeply nested'))
        root.append(h5)
      })
    })

    const snapshot = handle.getSnapshot()
    expect(snapshot.entries).toEqual([
      { index: 0, level: 1, text: 'Introduction' },
      { index: 1, level: 3, text: 'See inline code' },
      { index: 2, level: 2, text: 'Introduction' },
      { index: 3, level: 5, text: 'Deeply nested' },
    ])
  })

  it('excludes h6 headings, since the editor theme has no class for them', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor } = await mount(handle)

    await act(async () => {
      editor.update(() => {
        const root = $getRoot().clear()
        const h1 = $createHeadingNode('h1')
        h1.append($createTextNode('Kept'))
        root.append(h1)
        const h6 = $createHeadingNode('h6')
        h6.append($createTextNode('Dropped'))
        root.append(h6)
      })
    })

    expect(handle.getSnapshot().entries).toEqual([{ index: 0, level: 1, text: 'Kept' }])
  })

  it('updates entries as headings are added, edited, and removed, without remounting (US3-AC1)', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor } = await mount(handle)

    await act(async () => {
      editor.update(() => {
        const h1 = $createHeadingNode('h1')
        h1.append($createTextNode('First'))
        $getRoot().clear().append(h1)
      })
    })
    expect(handle.getSnapshot().entries).toEqual([{ index: 0, level: 1, text: 'First' }])

    // Add a second heading.
    await act(async () => {
      editor.update(() => {
        const h2 = $createHeadingNode('h2')
        h2.append($createTextNode('Second'))
        $getRoot().append(h2)
      })
    })
    expect(handle.getSnapshot().entries).toEqual([
      { index: 0, level: 1, text: 'First' },
      { index: 1, level: 2, text: 'Second' },
    ])

    // Rename the first heading.
    await act(async () => {
      editor.update(() => {
        const first = $getRoot().getFirstChild()
        // @ts-expect-error - test-only traversal of a HeadingNode's text child
        first.getFirstChild().setTextContent('Renamed')
      })
    })
    expect(handle.getSnapshot().entries[0]).toEqual({ index: 0, level: 1, text: 'Renamed' })

    // Remove the first heading.
    await act(async () => {
      editor.update(() => {
        $getRoot().getFirstChild()!.remove()
      })
    })
    expect(handle.getSnapshot().entries).toEqual([{ index: 0, level: 2, text: 'Second' }])
  })
})

describe('OutlinePlugin scroll-spy (FR-004)', () => {
  it('marks the heading at the top of the viewport active as the container scrolls (US2-AC1)', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor, container } = await mount(handle)

    // The host's scroll container is present in the DOM (as it would be in a
    // real app's chrome) before any heading renders, so the plugin can
    // discover it as soon as the first heading appears.
    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect

    await act(async () => {
      editor.update(() => {
        const root = $getRoot().clear()
        for (const [tag, text] of [
          ['h1', 'One'],
          ['h1', 'Two'],
          ['h1', 'Three'],
        ] as const) {
          const heading = $createHeadingNode(tag)
          heading.append($createTextNode(text))
          root.append(heading)
        }
      })
    })

    const headings = Array.from(
      container.querySelectorAll<HTMLElement>('.editor-heading-h1')
    )
    expect(headings).toHaveLength(3)

    // Initially nothing has scrolled past yet: all headings below the top.
    headings[0].getBoundingClientRect = () => ({ top: 10 }) as DOMRect
    headings[1].getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    headings[2].getBoundingClientRect = () => ({ top: 400 }) as DOMRect
    void act(() => scroller.dispatchEvent(new Event('scroll')))
    await frames(2)
    expect(handle.getSnapshot().activeIndex).toBe(0)

    // Scroll so the second heading has crossed the top of the viewport.
    headings[0].getBoundingClientRect = () => ({ top: -50 }) as DOMRect
    headings[1].getBoundingClientRect = () => ({ top: -5 }) as DOMRect
    headings[2].getBoundingClientRect = () => ({ top: 300 }) as DOMRect
    void act(() => scroller.dispatchEvent(new Event('scroll')))
    await frames(2)
    expect(handle.getSnapshot().activeIndex).toBe(1)
  })
})

describe('OutlinePlugin scrollToHeading (FR-003 / US1-AC2)', () => {
  it('scrolls the container to the heading at the given index', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor } = await mount(handle)

    await act(async () => {
      editor.update(() => {
        const root = $getRoot().clear()
        const h1 = $createHeadingNode('h1')
        h1.append($createTextNode('First'))
        root.append(h1)
        const h2 = $createHeadingNode('h2')
        h2.append($createTextNode('Second'))
        root.append(h2)
      })
    })

    const scroller = editor.getRootElement()!.parentElement!
    scroller.id = 'editor-scroll-container'
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    scroller.scrollTop = 0

    const target = editor.getRootElement()!.querySelector<HTMLElement>('.editor-heading-h2')!
    target.getBoundingClientRect = () => ({ top: 500 }) as DOMRect

    act(() => handle.scrollToHeading(1))
    // Asserts the H2 entry's own computed position (top 500 -> scrollTo 484,
    // per `scrollElementIntoView`'s margin), not just that some scroll
    // happened — a call count alone would also pass for a scroll to H1 or an
    // arbitrary offset.
    expect(scrollTo).toHaveBeenCalledWith({ top: 484, behavior: 'smooth' })
  })

  it('no-ops once the editor has unmounted', async () => {
    const handle = createDocumentOutlineHandle()
    const { editor } = await mount(handle)
    await act(async () => {
      editor.update(() => {
        const h1 = $createHeadingNode('h1')
        h1.append($createTextNode('First'))
        $getRoot().clear().append(h1)
      })
    })

    cleanup()

    // Must not throw when nothing is connected anymore.
    expect(() => handle.scrollToHeading(0)).not.toThrow()
  })
})

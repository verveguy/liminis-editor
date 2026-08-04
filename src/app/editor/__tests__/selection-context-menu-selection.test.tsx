/**
 * The selection-context menu must not destroy the selection it acts on.
 *
 * The menu is a fixed-position overlay rendered as a sibling of the
 * contenteditable, so pressing one of its buttons moves focus out of the
 * editor on `mousedown` — collapsing `window.getSelection()` before any
 * `onClick` handler runs. That matters because the "Correction…" entry
 * dispatches `OPEN_ANNOTATION_COMPOSER_COMMAND`, and `AnnotationPlugin`'s
 * handler reads the *native* selection and returns silently when it is
 * collapsed. The visible failure would be a correction panel that opens
 * normally while the anchor capture behind it quietly produced nothing.
 *
 * jsdom does not model focus-driven selection collapse, so asserting on a
 * post-click `window.getSelection()` here would pass no matter what the
 * component did. The load-bearing behaviour is instead asserted directly:
 * mousedown inside the menu is default-prevented, which is what stops the
 * browser from moving focus in the first place.
 */

import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, act, cleanup, fireEvent } from '@testing-library/react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
} from 'lexical'
import { SelectionContextMenuPlugin } from '../SelectionContextMenuPlugin'
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils'

afterEach(cleanup)

/** Seeds one paragraph and selects the word "quick" in it. */
function Seed() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode('The quick brown fox')
        paragraph.append(text)
        root.append(paragraph)

        const selection = $createRangeSelection()
        selection.anchor.set(text.getKey(), 4, 'text')
        selection.focus.set(text.getKey(), 9, 'text')
        $setSelection(selection)
      },
      { discrete: true },
    )
  }, [editor])

  return null
}

function renderMenu() {
  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'selection-context-menu-test',
        nodes: editorNodes,
        onError: (error: Error) => {
          throw error
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <Seed />
      <SelectionContextMenuPlugin onSelectionContextMenu={vi.fn()} correctionKindEnabled />
    </LexicalComposer>,
  )

  // The plugin listens on the Lexical root element, not on document.
  const root = utils.container.querySelector('[contenteditable="true"]')
  if (!root) throw new Error('no contenteditable root')
  act(() => {
    fireEvent.contextMenu(root, { clientX: 10, clientY: 20 })
  })

  return utils
}

describe('SelectionContextMenuPlugin — preserving the selection across a menu click', () => {
  it('default-prevents mousedown inside the menu, so focus never leaves the editor', () => {
    const { getByText } = renderMenu()

    const correction = getByText('Correction…')
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      correction.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('applies to every entry in the menu, not just the correction one', () => {
    const { getByText } = renderMenu()

    const chat = getByText('Chat about this…')
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      chat.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('still lets the click through — the menu entry remains operable', () => {
    const { getByText, queryByText } = renderMenu()

    expect(queryByText('Correction…')).not.toBeNull()
    act(() => {
      fireEvent.click(getByText('Correction…'))
    })

    // handleCorrection closes the menu after opening the correction panel.
    expect(queryByText('Correction…')).toBeNull()
  })
})

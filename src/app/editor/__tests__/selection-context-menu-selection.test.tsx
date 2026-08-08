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
  COMMAND_PRIORITY_CRITICAL,
} from 'lexical'
import { SelectionContextMenuPlugin } from '../SelectionContextMenuPlugin'
import { OPEN_ANNOTATION_COMPOSER_COMMAND } from '../annotationCommands'
import { useCorrectionStore } from '../../../stores/correctionStore'
import { editorNodes } from '../../mapper/__tests__/roundtrip-test-utils'

afterEach(() => {
  cleanup()
  // `handleCorrection` opens the module-level correction store. Left open it
  // leaks into every test that runs after this file, which is a classic source
  // of order-dependent failures (review finding, CodeRabbit).
  useCorrectionStore.getState().close()
})

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

/** Records every `OPEN_ANNOTATION_COMPOSER_COMMAND` kind the menu dispatches. */
function CommandRecorder({ seen }: { seen: string[] }) {
  const [editor] = useLexicalComposerContext()
  useEffect(
    () =>
      editor.registerCommand(
        OPEN_ANNOTATION_COMPOSER_COMMAND,
        ({ kind }) => {
          seen.push(kind)
          return true
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor, seen],
  )
  return null
}

function renderMenu(
  extra?: React.ReactNode,
  annotationAffordances: { kind: string; label: string }[] = [{ kind: 'correction', label: 'Correction…' }],
) {
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
      {extra}
      <SelectionContextMenuPlugin onSelectionContextMenu={vi.fn()} annotationAffordances={annotationAffordances} />
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

  // The preserved selection is only worth anything because something reads it:
  // the "Correction…" entry dispatches `OPEN_ANNOTATION_COMPOSER_COMMAND` with
  // `kind: 'correction'`, and that is what enters the shared capture path
  // (SC-001). Nothing asserted the dispatch, so dropping
  // `onCaptureCorrectionAnchor?.()` from `handleCorrection` — or passing the
  // wrong kind — would have left the rest of this suite green (review finding,
  // CodeRabbit).
  it('dispatches the annotation composer command with the correction kind', () => {
    const seen: string[] = []
    const { getByText } = renderMenu(<CommandRecorder seen={seen} />)

    act(() => {
      fireEvent.click(getByText('Correction…'))
    })

    expect(seen).toEqual(['correction'])
  })

  // The panel must still open — the dispatch is additive, not a replacement.
  it('still opens the correction panel with the selected text', () => {
    const { getByText } = renderMenu()

    act(() => {
      fireEvent.click(getByText('Correction…'))
    })

    const state = useCorrectionStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.selectedText).toBe('quick')
  })
})

// User Story 2 (FR-004/FR-005/FR-010): a contextMenu-surfaced kind is
// reachable under any name, not just the literal 'correction'.
describe('SelectionContextMenuPlugin — a contextMenu kind under any name', () => {
  it('offers the configured label for a non-correction kind', () => {
    const { getByText, queryByText } = renderMenu(undefined, [{ kind: 'note', label: 'Note…' }])

    expect(getByText('Note…')).not.toBeNull()
    expect(queryByText('Correction…')).toBeNull()
  })

  it('dispatches the annotation composer command with that kind, not "correction"', () => {
    const seen: string[] = []
    const { getByText } = renderMenu(<CommandRecorder seen={seen} />, [{ kind: 'note', label: 'Note…' }])

    act(() => {
      fireEvent.click(getByText('Note…'))
    })

    expect(seen).toEqual(['note'])
  })

  it('does not open the legacy correction panel for a non-correction kind', () => {
    const { getByText } = renderMenu(undefined, [{ kind: 'note', label: 'Note…' }])

    act(() => {
      fireEvent.click(getByText('Note…'))
    })

    expect(useCorrectionStore.getState().isOpen).toBe(false)
  })

  it('offers one entry per kind when multiple kinds are configured on this surface (FR-010)', () => {
    const { getByText } = renderMenu(undefined, [
      { kind: 'note', label: 'Note…' },
      { kind: 'correction', label: 'Correction…' },
    ])

    expect(getByText('Note…')).not.toBeNull()
    expect(getByText('Correction…')).not.toBeNull()
  })
})

// User Story 3 / FR-007: with no configured affordances, the menu offers no
// annotation entry and never dispatches the command.
describe('SelectionContextMenuPlugin — no configured kind means no affordance', () => {
  it('renders no annotation entry when annotationAffordances is empty', () => {
    const { queryByText } = renderMenu(undefined, [])

    expect(queryByText('Correction…')).toBeNull()
  })

  it('never dispatches OPEN_ANNOTATION_COMPOSER_COMMAND when no affordance is configured', () => {
    const seen: string[] = []
    renderMenu(<CommandRecorder seen={seen} />, [])

    expect(seen).toEqual([])
  })
})

// liminis-app passes ANNOTATION_KINDS (a `correction` kind, contextMenu
// surface) at five <App> mount sites but wires `onCreateAnnotation` at none
// of them. This is the exact shape that produces: the plugin has no host
// listener for the command it dispatches, only its own name-gated legacy
// panel. Asserted directly, without mounting AnnotationPlugin at all, so the
// scenario can't accidentally depend on a listener being present.
describe('SelectionContextMenuPlugin — a contextMenu kind with no onCreateAnnotation host handler', () => {
  it('still renders and operates the entry (AnnotationPlugin is never mounted in this test)', () => {
    const { getByText, queryByText } = renderMenu()

    expect(getByText('Correction…')).not.toBeNull()
    act(() => {
      fireEvent.click(getByText('Correction…'))
    })

    // The command dispatch above found no registered listener and was a
    // no-op; the legacy panel opening below is unaffected by that.
    expect(queryByText('Correction…')).toBeNull()
    expect(useCorrectionStore.getState().isOpen).toBe(true)
  })
})

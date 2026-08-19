/**
 * Coverage for DocumentOutline (issue #69): renders nothing without headings
 * (FR-007), click activates scrollToHeading (FR-003/US1-AC2), the active
 * entry is styled and marked (FR-004), and the outline self-scrolls to keep
 * the active entry visible (US2-AC2). Driven through the same
 * `DocumentOutlineHandle` surface `OutlinePlugin` publishes to, not through
 * component internals.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { DocumentOutline } from '../DocumentOutline'
import { createDocumentOutlineHandle, OutlineHandleImpl } from '../documentOutlineHandle'

afterEach(() => {
  cleanup()
})

describe('DocumentOutline', () => {
  it('renders nothing when the document has no headings (FR-007)', () => {
    const handle = createDocumentOutlineHandle()
    const { container } = render(<DocumentOutline handle={handle} />)

    expect(container.firstChild).toBeNull()
  })

  it('lists entries indented by level and calls scrollToHeading on click (US1-AC1/US1-AC2)', () => {
    const handle = createDocumentOutlineHandle()
    const impl = handle as OutlineHandleImpl
    act(() => {
      impl.publish({
        entries: [
          { index: 0, level: 1, text: 'Introduction' },
          { index: 1, level: 2, text: 'Details' },
        ],
        activeIndex: null,
      })
    })

    const scrollToHeading = vi.spyOn(handle, 'scrollToHeading')
    const { getByText } = render(<DocumentOutline handle={handle} />)

    expect(getByText('Introduction')).toBeTruthy()
    // Indentation is keyed off `data-outline-level`, distinct per entry — a
    // flat (unindented) render would still pass a text-only assertion.
    expect(getByText('Introduction').closest('li')?.getAttribute('data-outline-level')).toBe('1')
    expect(getByText('Details').closest('li')?.getAttribute('data-outline-level')).toBe('2')
    const detailsButton = getByText('Details').closest('button')!
    fireEvent.click(detailsButton)

    expect(scrollToHeading).toHaveBeenCalledWith(1)
  })

  it('calls onEntrySelect with the clicked entry, alongside scrollToHeading (issue #84)', () => {
    const handle = createDocumentOutlineHandle()
    const impl = handle as OutlineHandleImpl
    act(() => {
      impl.publish({
        entries: [
          { index: 0, level: 1, text: 'Introduction', line: 1 },
          { index: 1, level: 2, text: 'Details', line: 3 },
        ],
        activeIndex: null,
      })
    })

    const scrollToHeading = vi.spyOn(handle, 'scrollToHeading')
    const onEntrySelect = vi.fn()
    const { getByText } = render(<DocumentOutline handle={handle} onEntrySelect={onEntrySelect} />)

    fireEvent.click(getByText('Details').closest('button')!)

    expect(scrollToHeading).toHaveBeenCalledWith(1)
    expect(onEntrySelect).toHaveBeenCalledWith({ index: 1, level: 2, text: 'Details', line: 3 })
  })

  it('marks the active entry (FR-004)', () => {
    const handle = createDocumentOutlineHandle()
    const impl = handle as OutlineHandleImpl
    act(() => {
      impl.publish({
        entries: [
          { index: 0, level: 1, text: 'One' },
          { index: 1, level: 1, text: 'Two' },
        ],
        activeIndex: 1,
      })
    })

    const { container } = render(<DocumentOutline handle={handle} />)
    const items = container.querySelectorAll('.editor-outline-item')
    expect(items[0].classList.contains('editor-outline-item-active')).toBe(false)
    expect(items[1].classList.contains('editor-outline-item-active')).toBe(true)
    expect(items[1].querySelector('button')?.getAttribute('aria-current')).toBe('location')
  })

  it('scrolls the active entry into view within the outline as it changes (US2-AC2)', () => {
    const handle = createDocumentOutlineHandle()
    const impl = handle as OutlineHandleImpl
    act(() => {
      impl.publish({
        entries: [
          { index: 0, level: 1, text: 'One' },
          { index: 1, level: 1, text: 'Two' },
        ],
        activeIndex: 0,
      })
    })

    render(<DocumentOutline handle={handle} />)

    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    try {
      act(() => {
        impl.publish({
          entries: [
            { index: 0, level: 1, text: 'One' },
            { index: 1, level: 1, text: 'Two' },
          ],
          activeIndex: 1,
        })
      })

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      scrollIntoView.mockRestore()
    }
  })
})

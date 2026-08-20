/**
 * Coverage for `DocumentOutlineHandle`'s markdown-derived path (issue #84):
 * `publishFromMarkdown`/`setActiveLine` produce a correct snapshot with zero
 * Lexical/React involved (SC-001), work through the plain
 * `DocumentOutlineHandle` interface with no cast to `OutlineHandleImpl`, and
 * notify subscribers on a line-only change — a regression guard for
 * `snapshotsEqual` silently dropping updates that only differ by `line`.
 */

import { describe, expect, it, vi } from 'vitest'
import { createDocumentOutlineHandle, type DocumentOutlineHandle } from '../documentOutlineHandle'

describe('DocumentOutlineHandle markdown path', () => {
  it('publishFromMarkdown derives and publishes entries with zero Lexical/React involved (SC-001)', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# Title\n\n## Sub\n')

    expect(handle.getSnapshot()).toEqual({
      entries: [
        { index: 0, level: 1, text: 'Title', line: 1 },
        { index: 1, level: 2, text: 'Sub', line: 3 },
      ],
      activeIndex: null,
    })
  })

  it('renders nothing when the markdown has no headings (FR-007)', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('Just text.')

    expect(handle.getSnapshot()).toEqual({ entries: [], activeIndex: null })
  })

  it('setActiveLine resolves and publishes the active index without re-deriving entries', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# One\n\nbody\n\n## Two\n')

    handle.setActiveLine(4)
    expect(handle.getSnapshot().activeIndex).toBe(0)
    expect(handle.getSnapshot().entries).toEqual([
      { index: 0, level: 1, text: 'One', line: 1 },
      { index: 1, level: 2, text: 'Two', line: 5 },
    ])

    handle.setActiveLine(5)
    expect(handle.getSnapshot().activeIndex).toBe(1)
  })

  it('setActiveLine(null) resolves activeIndex to null (no active heading yet)', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# One\n')
    handle.setActiveLine(1)
    expect(handle.getSnapshot().activeIndex).toBe(0)

    handle.setActiveLine(null)
    expect(handle.getSnapshot().activeIndex).toBeNull()
  })

  it('notifies subscribers on a setActiveLine-only change (same entries, new activeIndex)', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# One\n\nbody\n\n## Two\n')

    const listener = vi.fn()
    handle.subscribe(listener)

    handle.setActiveLine(5)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers on a publishFromMarkdown-only line change (same text/level, different line) — snapshotsEqual regression guard', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# One\n')

    const listener = vi.fn()
    handle.subscribe(listener)

    // Same text/level, different line — a stale snapshotsEqual that forgot
    // to compare `line` would treat this as unchanged and never notify.
    handle.publishFromMarkdown('\n# One\n')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(handle.getSnapshot().entries[0].line).toBe(2)
  })

  it('does not notify subscribers when publishFromMarkdown produces an identical snapshot', () => {
    const handle: DocumentOutlineHandle = createDocumentOutlineHandle()
    handle.publishFromMarkdown('# One\n')

    const listener = vi.fn()
    handle.subscribe(listener)

    handle.publishFromMarkdown('# One\n')
    expect(listener).not.toHaveBeenCalled()
  })
})

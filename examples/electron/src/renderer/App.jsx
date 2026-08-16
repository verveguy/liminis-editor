/**
 * Renderer for the `@liminis/editor` Electron e2e shell (verveguy/liminis-editor#2).
 *
 * Imports only the package's root entry point (FR-008) — no deep path into
 * `dist/`, no reach into package internals.
 *
 * One `surface: 'toolbar'` annotation kind is configured unconditionally,
 * reproducing the shape of verveguy/liminis#961 (a toolbar-surfaced kind with
 * no working affordance). `?readonly=1` in the loaded URL — set by
 * `main.cjs` when launched with `--readonly` — toggles `editable`,
 * reproducing the shape of verveguy/liminis#965 (the create affordance
 * unreachable specifically in read-only mode). `?content=<base64>` (#12) —
 * set by `main.cjs` when launched with `--content-file <path>` — supplies
 * a real fixture as the initial document instead of the hardcoded sample.
 */
import { useState } from 'react'
import { Editor } from '@liminis/editor'

import '@liminis/editor/styles.css'

const INITIAL = `# Electron shell

Select this sentence about the quick brown fox and click **Note** in the toolbar.
`

const ANNOTATION_KINDS = {
  note: {
    markerStyle: 'highlight',
    createAffordance: { surface: 'toolbar', label: 'Note' },
    retainMarkOnCreate: true,
  },
}

/** Decodes a base64 string as UTF-8 text (plain atob() mishandles non-ASCII). */
function decodeBase64Utf8(base64) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const searchParams = new URLSearchParams(window.location.search)
const editable = searchParams.get('readonly') !== '1'
const encodedContent = searchParams.get('content')
const initialContent = encodedContent ? decodeBase64Utf8(encodedContent) : INITIAL

export function App() {
  const [annotations, setAnnotations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [nextId, setNextId] = useState(1)
  // Reflects the editor's live exported markdown so Playwright can assert on
  // it (e.g. after toggling a checkbox) without a preload/IPC bridge to read
  // Lexical's internal state directly. Seeded with initialContent since
  // OnChangePlugin skips firing for the very first update out of an empty
  // editor state (see @lexical/react's own `prevEditorState.isEmpty()`
  // guard) — nothing else would populate this before the first edit.
  const [markdown, setMarkdown] = useState(initialContent)

  const handleCreate = (event) => {
    if (!event.anchor) return
    const id = `note-${nextId}`
    setNextId((n) => n + 1)
    setAnnotations((current) => [
      ...current,
      { id, kind: 'note', anchor: event.anchor, payload: { note: `Note ${nextId}` } },
    ])
    setActiveId(id)
  }

  return (
    <div data-testid="shell" data-editable={editable}>
      <Editor
        initialContent={initialContent}
        onChange={setMarkdown}
        editable={editable}
        annotationKinds={ANNOTATION_KINDS}
        annotations={annotations}
        activeAnnotationId={activeId}
        onCreateAnnotation={handleCreate}
        onActivateAnnotation={setActiveId}
      />
      <div data-testid="markdown-output" style={{ display: 'none' }}>{markdown}</div>
    </div>
  )
}

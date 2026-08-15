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
 * unreachable specifically in read-only mode).
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

const editable = new URLSearchParams(window.location.search).get('readonly') !== '1'

export function App() {
  const [annotations, setAnnotations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [nextId, setNextId] = useState(1)

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
        initialContent={INITIAL}
        onChange={() => {}}
        editable={editable}
        annotationKinds={ANNOTATION_KINDS}
        annotations={annotations}
        activeAnnotationId={activeId}
        onCreateAnnotation={handleCreate}
        onActivateAnnotation={setActiveId}
      />
    </div>
  )
}

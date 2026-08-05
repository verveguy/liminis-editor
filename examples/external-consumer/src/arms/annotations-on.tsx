/**
 * Arm 3 — the same consumer, with one annotation kind configured.
 *
 * The control for `annotations-off.tsx`. A measurement that finds no annotation
 * code in the disabled arm proves nothing unless the same measurement finds it
 * in the enabled arm — otherwise the probe could simply be looking in the wrong
 * place. A real annotations-enabled host also reaches for the anchor model to
 * capture and re-resolve anchors, which is what this arm does.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@liminis/editor'
import type { AnnotationKindConfigs, AnnotationCreateEvent } from '@liminis/editor'
import { captureAnchor, resolveAnchors } from '@liminis/editor/annotations'
import type { Annotation } from '@liminis/editor/annotations'
import '@liminis/editor/styles.css'

const KINDS: AnnotationKindConfigs = {
  note: {
    markerStyle: 'highlight',
    createAffordance: { surface: 'toolbar', label: 'Note' },
    retainMarkOnCreate: true,
  },
}

function AnnotatedEditor() {
  const [markdown, setMarkdown] = useState('# Annotated editor\n\nSelect text and add a note.\n')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const handleCreate = (event: AnnotationCreateEvent) => {
    const id = `note-${annotations.length + 1}`
    setAnnotations((current) => [...current, { id, kind: 'note', anchor: event.anchor }])
    setActiveId(id)
  }

  return (
    <Editor
      initialContent={markdown}
      onChange={setMarkdown}
      annotationKinds={KINDS}
      annotations={annotations}
      activeAnnotationId={activeId}
      onCreateAnnotation={handleCreate}
      onActivateAnnotation={setActiveId}
    />
  )
}

// Exercise the headless anchor surface the same way a real host would.
export async function reanchor(annotations: Annotation[], text: string) {
  return resolveAnchors(
    annotations.map((a) => ({ id: a.id, anchor: a.anchor })),
    text,
  )
}
;(globalThis as Record<string, unknown>).__captureAnchor = captureAnchor

const host = document.getElementById('root')
if (host) createRoot(host).render(<AnnotatedEditor />)

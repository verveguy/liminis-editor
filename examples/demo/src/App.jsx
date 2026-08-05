/**
 * A runnable demo of `@liminis/editor` (#940 / FR-008).
 *
 * Two constraints shape this file:
 *
 * 1. **It imports only the package's public entry points.** No deep path into
 *    `dist/`, no reach into package internals. The demo must not become a
 *    privileged second consumer that keeps working while a real adopter's does
 *    not.
 * 2. **It is a plain external consumer.** It installs the packed tarball, the
 *    same way an adopter would, and does nothing the README does not describe.
 */
import { useState } from 'react'

// The editor itself, plus the annotation-configuration types, come from the
// root entry. `captureAnchor`/`resolveAnchors` live on `./annotations` because
// they are DOM-free and usable outside a rendered editor.
import { Editor } from '@liminis/editor'
import { resolveAnchors } from '@liminis/editor/annotations'
import { parseMarkdown, isHeading, isText } from '@liminis/editor/markdown'

// Required. Without it the editor renders unstyled and annotation markers are
// invisible — the failure is silent, which is why the README says so twice.
import '@liminis/editor/styles.css'

const INITIAL = `# @liminis/editor

A markdown WYSIWYG editor that round-trips through mdast.

## Try it

- Type some **bold** and *italic* text
- Make a table, a task list, a code block
- Select a passage and click **Note** in the toolbar to place an annotation

## Annotations

Annotations are range-anchored markers whose anchors survive edits. Select this
sentence and add a note, then edit the paragraph around it — the marker follows.

| Feature | Works |
| --- | --- |
| Tables | yes |
| Wiki-links | [[some-page\\|see this page]] |
`

/**
 * One annotation kind. This object — and nothing else — is what turns the
 * annotation mechanism on. A "comment" feature and a "correction" feature
 * differ only in the value supplied here.
 */
const ANNOTATION_KINDS = {
  note: {
    markerStyle: 'highlight',
    createAffordance: { surface: 'toolbar', label: 'Note' },
    retainMarkOnCreate: true,
  },
}

export function App() {
  const [markdown, setMarkdown] = useState(INITIAL)
  const [annotations, setAnnotations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [nextId, setNextId] = useState(1)

  // The host mints the id and owns storage; the package treats both as opaque.
  const handleCreate = (event) => {
    const id = `note-${nextId}`
    setNextId((n) => n + 1)
    setAnnotations((current) => [
      ...current,
      { id, kind: 'note', anchor: event.anchor, payload: { note: `Note ${nextId}` } },
    ])
    setActiveId(id)
  }

  // Re-resolve every anchor against the current text. A real host would do this
  // on load and after external edits; here it is a button so the mechanism is
  // visible rather than merely claimed.
  const handleReanchor = async () => {
    const result = await resolveAnchors(
      annotations.map((a) => ({ id: a.id, anchor: a.anchor })),
      markdown,
    )
    setAnnotations((current) =>
      current.map((a) => {
        const resolution = result.resolutions?.find((r) => r.id === a.id)
        return resolution ? { ...a, outcome: resolution.resolution.outcome } : a
      }),
    )
  }

  // `./markdown` with no editor mounted: pure mdast, no Lexical, no MathJax.
  const headings = parseMarkdown(markdown).root
    .children.filter(isHeading)
    .map((h) => ({
      depth: h.depth,
      text: h.children.filter(isText).map((t) => t.value).join(''),
    }))

  return (
    <div className="demo">
      <header className="demo-header">
        <h1>@liminis/editor</h1>
        <p>Select text and click <strong>Note</strong> in the toolbar to annotate.</p>
      </header>

      <div className="demo-body">
        <aside className="demo-sidebar">
          <section>
            <h2>Outline</h2>
            <p className="demo-hint">Built with <code>@liminis/editor/markdown</code> — no editor involved.</p>
            <ul className="demo-outline">
              {headings.map((h, i) => (
                <li key={i} style={{ paddingLeft: `${(h.depth - 1) * 12}px` }}>{h.text}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Annotations ({annotations.length})</h2>
            <p className="demo-hint">Ids and storage are the host's; the package owns anchors and markers.</p>
            {annotations.length === 0 ? (
              <p className="demo-empty">None yet.</p>
            ) : (
              <>
                <ul className="demo-annotations">
                  {annotations.map((a) => (
                    <li
                      key={a.id}
                      className={a.id === activeId ? 'is-active' : undefined}
                      onClick={() => setActiveId(a.id)}
                    >
                      <strong>{a.payload?.note ?? a.id}</strong>
                      <span className="demo-quote">“{a.anchor.quotedText}”</span>
                      <span className="demo-outcome">{a.outcome ?? 'unchanged'}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={handleReanchor}>Re-resolve anchors</button>
              </>
            )}
          </section>
        </aside>

        <main className="demo-editor">
          <Editor
            initialContent={INITIAL}
            onChange={setMarkdown}
            annotationKinds={ANNOTATION_KINDS}
            annotations={annotations}
            activeAnnotationId={activeId}
            onCreateAnnotation={handleCreate}
            onActivateAnnotation={setActiveId}
          />
        </main>
      </div>
    </div>
  )
}

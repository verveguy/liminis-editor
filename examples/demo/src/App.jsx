/**
 * A runnable demo of `@liminis/editor` (#940 / FR-008), grown into a feature
 * shell by verveguy/liminis-editor#2: a picker over the shared round-trip
 * fixture corpus, rendering every fixture-representable node class
 * `editorNodes.ts` declares (FR-005/FR-006/FR-007).
 *
 * Two constraints shape this file:
 *
 * 1. **It imports only the package's public entry points.** No deep path into
 *    `dist/`, no reach into package internals. The demo must not become a
 *    privileged second consumer that keeps working while a real adopter's does
 *    not.
 * 2. **It is a plain external consumer.** It installs the packed tarball, the
 *    same way an adopter would, and does nothing the README does not describe.
 *
 * `./fixtures.generated.js` is not hand-written content — it is generated
 * from the corpus by `scripts/generate-demo-fixtures.mjs`
 * (docs/decisions/adr-081.md) and gitignored, so this file never carries a
 * second, drifting copy of #1's fixtures.
 */
import { useMemo, useState } from 'react'

// The editor itself, plus the annotation-configuration types, come from the
// root entry. `captureAnchor`/`resolveAnchors` live on `./annotations` because
// they are DOM-free and usable outside a rendered editor.
import { Editor } from '@liminis/editor'
import { resolveAnchors } from '@liminis/editor/annotations'
import { parseMarkdown, isHeading, isText } from '@liminis/editor/markdown'

// Required. Without it the editor renders unstyled and annotation markers are
// invisible — the failure is silent, which is why the README says so twice.
import '@liminis/editor/styles.css'

import { fixtures } from './fixtures.generated.js'

// Where the corpus actually lives, shown next to the loaded fixture so what's
// on screen is traceable to a specific file in the shared corpus (SC-003),
// not just to "the fixtures" in the abstract.
const CORPUS_PATH = 'src/app/mapper/__tests__/fixtures/roundtrip/'

const DEFAULT_FIXTURE = fixtures.find((f) => f.name === '50-reference-readme') ?? fixtures[0]

/** Fixtures grouped by their top-level corpus subdirectory, in name order. */
function groupFixtures(list) {
  const groups = new Map()
  for (const fixture of list) {
    if (!groups.has(fixture.group)) groups.set(fixture.group, [])
    groups.get(fixture.group).push(fixture)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const GROUPED_FIXTURES = groupFixtures(fixtures)

/**
 * The document version anchors are stamped with.
 *
 * This has to *track the document*, not be a constant. An anchor records the
 * version it was captured against, and a resolution records the version it was
 * resolved against — so if the version never changes, every anchor claims to
 * have been captured against the same revision no matter when it was made, and
 * the metadata stops meaning anything. A real host would use a content hash or
 * a git SHA; this is the former, kept deliberately tiny (FNV-1a) so the demo
 * stays dependency-free.
 */
function documentVersion(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `demo-${hash.toString(16).padStart(8, '0')}`
}

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
  const [selectedName, setSelectedName] = useState(DEFAULT_FIXTURE.name)
  const selectedFixture = fixtures.find((f) => f.name === selectedName) ?? DEFAULT_FIXTURE

  return (
    <div className="demo">
      <header className="demo-header">
        <h1>@liminis/editor</h1>
        <p>Pick a fixture on the left, then select text and click <strong>Note</strong> in the toolbar to annotate.</p>
      </header>

      <div className="demo-body">
        <aside className="demo-fixture-picker">
          <h2>Fixtures</h2>
          <p className="demo-hint">
            From the shared round-trip corpus (<code>{CORPUS_PATH}</code>), also used by
            verveguy/liminis-editor#1's node-class completeness gate.
          </p>
          {GROUPED_FIXTURES.map(([group, items]) => (
            <section key={group}>
              <h3>{group}</h3>
              <ul className="demo-fixture-list">
                {items.map((fixture) => (
                  <li key={fixture.name}>
                    <button
                      type="button"
                      className={fixture.name === selectedName ? 'is-active' : undefined}
                      onClick={() => setSelectedName(fixture.name)}
                      aria-current={fixture.name === selectedName ? 'true' : undefined}
                    >
                      {fixture.name.includes('/') ? fixture.name.slice(fixture.name.indexOf('/') + 1) : fixture.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </aside>

        {/* Keyed on the fixture name so switching fixtures remounts this whole
            subtree — a fresh document should not carry over annotations, active
            selection, or markdown state from the previous one. */}
        <FixtureWorkspace key={selectedFixture.name} fixture={selectedFixture} />
      </div>
    </div>
  )
}

function FixtureWorkspace({ fixture }) {
  const [markdown, setMarkdown] = useState(fixture.markdown)
  const [annotations, setAnnotations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [nextId, setNextId] = useState(1)

  // Recomputed whenever the text changes, so an anchor captured before an edit
  // and one captured after carry genuinely different revisions. Editing back to
  // the original text yields the original version again, which is the point of
  // hashing content rather than counting edits.
  const docVersion = useMemo(() => documentVersion(markdown), [markdown])

  // The host mints the id and owns storage; the package treats both as opaque.
  // `event.anchor` arrives without `docVersion` — the package cannot know which
  // version of the document you are persisting against, so you stamp it with
  // the version current at capture time.
  const handleCreate = (event) => {
    if (!event.anchor) return
    const id = `note-${nextId}`
    setNextId((n) => n + 1)
    setAnnotations((current) => [
      ...current,
      {
        id,
        kind: 'note',
        anchor: { ...event.anchor, docVersion },
        payload: { note: `Note ${nextId}` },
      },
    ])
    setActiveId(id)
  }

  // Re-resolve every anchor against the current text. A real host would do this
  // on load and after external edits; here it is a button so the mechanism is
  // visible rather than merely claimed.
  const handleReanchor = async () => {
    const results = await resolveAnchors(
      annotations.map((a) => ({ id: a.id, anchor: a.anchor })),
      markdown,
      docVersion,
    )
    setAnnotations((current) =>
      current.map((a) => {
        const result = results.find((r) => r.id === a.id)
        if (!result) return a
        return {
          ...a,
          outcome: result.outcome,
          anchor: result.resolvedAnchor ?? a.anchor,
        }
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
    <>
      <main className="demo-editor">
        <p className="demo-source">
          Loaded from <code>{CORPUS_PATH}{fixture.name}.md</code>
        </p>
        <Editor
          initialContent={fixture.markdown}
          onChange={setMarkdown}
          annotationKinds={ANNOTATION_KINDS}
          annotations={annotations}
          activeAnnotationId={activeId}
          onCreateAnnotation={handleCreate}
          onActivateAnnotation={setActiveId}
        />
      </main>

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
                  // A button, not a clickable <li> — activating an annotation
                  // has to be reachable by keyboard, not just by mouse.
                  <li key={a.id} className={a.id === activeId ? 'is-active' : undefined}>
                    <button type="button" onClick={() => setActiveId(a.id)}>
                      <strong>{a.payload?.note ?? a.id}</strong>
                      <span className="demo-quote">“{a.anchor.targetText}”</span>
                      <span className="demo-outcome">{a.outcome ?? 'unchanged'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={handleReanchor}>Re-resolve anchors</button>
            </>
          )}
        </section>
      </aside>
    </>
  )
}

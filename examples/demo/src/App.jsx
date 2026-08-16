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
import { useEffect, useMemo, useRef, useState } from 'react'

// The editor itself, plus the annotation-configuration types, come from the
// root entry. `captureAnchor`/`resolveAnchors` live on `./annotations` because
// they are DOM-free and usable outside a rendered editor.
import { Editor } from '@liminis/editor'
import { resolveAnchors } from '@liminis/editor/annotations'
import { parseMarkdown, isHeading, isText } from '@liminis/editor/markdown'

// Required. Without it the editor renders unstyled and annotation markers are
// invisible — the failure is silent, which is why the README says so twice.
import '@liminis/editor/styles.css'

import { Docs } from './Docs.jsx'
import { fixtures } from './fixtures.generated.js'
import { useScrollSync } from './useScrollSync.js'

// Set by the Pages workflow from the triggering release's `tag_name`
// (verveguy/liminis-editor#3, FR-011). `package.json`'s checked-in version is
// not meaningful here — the package is `private: true` and has never been
// published, so a local build has no real version to show.
const DEMO_VERSION = import.meta.env.VITE_LIMINIS_EDITOR_VERSION || 'unpublished (local build)'

// Where the corpus actually lives, shown next to the loaded fixture so what's
// on screen is traceable to a specific file in the shared corpus (SC-003),
// not just to "the fixtures" in the abstract.
const CORPUS_PATH = 'src/app/mapper/__tests__/fixtures/roundtrip/'

/** Group the fixture generator stamps on documents from `examples/shared/`. */
const SHARED_GROUP = 'all'

/** How long typing in the raw pane must pause before it re-imports. */
const RAW_APPLY_DELAY_MS = 500

/**
 * Corpus subdirectories are named after the issue that produced them
 * (`897-list-item-block-content`). The number is provenance for a
 * contributor and noise for someone browsing the demo, so it is dropped
 * from the label only — `fixture.name` keeps it, and the path shown above
 * the editor still resolves to a real file.
 */
function groupLabel(group) {
  return group.replace(/^\d+-/, '')
}

const DEFAULT_FIXTURE =
  fixtures.find((f) => f.name === 'all-the-things') ??
  fixtures.find((f) => f.name === '50-reference-readme') ??
  fixtures[0]

/** Fixtures grouped by their top-level corpus subdirectory, in name order. */
function groupFixtures(list) {
  const groups = new Map()
  for (const fixture of list) {
    if (!groups.has(fixture.group)) groups.set(fixture.group, [])
    groups.get(fixture.group).push(fixture)
  }
  // `all` leads, then the rest alphabetically. The corpus groups are
  // regression fixtures named after the issue that produced them; the sample
  // document is what a first-time reader should meet first, and alphabetical
  // order would bury it mid-list.
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === SHARED_GROUP) return -1
    if (b === SHARED_GROUP) return 1
    // Sort on the *label*, not the raw name: the numeric prefixes are stripped
    // for display, so sorting on the raw name would order by a number the
    // reader cannot see — putting `897-list-item-block-content` above `c4`.
    return groupLabel(a).localeCompare(groupLabel(b))
  })
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
  const [view, setView] = useState('demo')
  const [selectedName, setSelectedName] = useState(DEFAULT_FIXTURE.name)
  const selectedFixture = fixtures.find((f) => f.name === selectedName) ?? DEFAULT_FIXTURE

  return (
    <div className="demo">
      <header className="demo-header">
        <div className="demo-header-top">
          <h1>@liminis/editor</h1>
          {/* Visible without further navigation regardless of which view is
              active (FR-011) — an evaluator needs to know which release this
              build represents before they trust anything else on the page. */}
          <span className="demo-version-badge" title="Published version this build represents">
            {DEMO_VERSION}
          </span>
          <nav className="demo-view-toggle" aria-label="Site sections">
            <button
              type="button"
              aria-pressed={view === 'demo'}
              className={view === 'demo' ? 'is-active' : undefined}
              onClick={() => setView('demo')}
            >
              Demo
            </button>
            <button
              type="button"
              aria-pressed={view === 'docs'}
              className={view === 'docs' ? 'is-active' : undefined}
              onClick={() => setView('docs')}
            >
              Documentation
            </button>
          </nav>
        </div>
        <p>Pick a fixture on the left, then select text and click <strong>Note</strong> in the toolbar to annotate.</p>
      </header>

      {view === 'docs' ? (
        <Docs />
      ) : (
        <div className="demo-body">
          <aside className="demo-fixture-picker">
            <h2>Fixtures</h2>
            <p className="demo-hint">
              From the shared round-trip corpus (<code>{CORPUS_PATH}</code>), also used by
              verveguy/liminis-editor#1's node-class completeness gate.
            </p>
            {GROUPED_FIXTURES.map(([group, items]) => (
              <section key={group}>
                <h3>{groupLabel(group)}</h3>
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
      )}
    </div>
  )
}

function FixtureWorkspace({ fixture }) {
  // `markdown` is the editor's output — what would land on disk. `raw` is what
  // the textarea shows. They are usually the same string; they diverge while
  // the raw pane is being typed into, until the debounce feeds it back.
  const [markdown, setMarkdown] = useState(fixture.markdown)
  const [raw, setRaw] = useState(fixture.markdown)
  // Bumping `n` remounts the editor with fresh content; `initialContent` alone
  // is only read on mount.
  const [seed, setSeed] = useState({ text: fixture.markdown, n: 0 })
  const editorPaneRef = useRef(null)
  const markdownPreRef = useRef(null)
  const gutterRef = useRef(null)
  const rawFocused = useRef(false)
  const applyTimer = useRef(null)

  useEffect(() => () => clearTimeout(applyTimer.current), [])

  /** Raw edits re-import into the editor once typing pauses. */
  function onRawChange(event) {
    const value = event.target.value
    setRaw(value)
    clearTimeout(applyTimer.current)
    applyTimer.current = setTimeout(() => {
      setSeed((s) => ({ text: value, n: s.n + 1 }))
    }, RAW_APPLY_DELAY_MS)
  }

  /**
   * The editor's output flows back into the raw pane — but never while that
   * pane has focus, or a round-trip that reformats what you just typed would
   * overwrite you mid-keystroke.
   */
  function onEditorChange(md) {
    setMarkdown(md)
    if (!rawFocused.current) setRaw(md)
  }

  /** The gutter does not scroll itself; it is translated to match. */
  function onRawScroll(event) {
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`
    }
  }

  // Keep the two panes on the same section as either is scrolled.
  useScrollSync(editorPaneRef, markdownPreRef, markdown)

  /**
   * Scroll the editor to its nth heading. Paired by ordinal with the outline,
   * which is derived from the same document by `parseMarkdown` — the same
   * pairing `useScrollSync` uses.
   *
   * Offsets are computed against the pane rather than using `scrollIntoView`,
   * which would also scroll ancestor containers and move the whole page. The
   * 16px margin leaves the heading just below the pane's top edge instead of
   * flush against it. The markdown pane follows via the scroll sync.
   */
  function scrollToHeading(index) {
    const pane = editorPaneRef.current
    const target = pane?.querySelectorAll('[class*="editor-heading-h"]')[index]
    if (!pane || !target) return
    const origin = pane.getBoundingClientRect().top - pane.scrollTop
    const top = target.getBoundingClientRect().top - origin - 16
    pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }
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
        <div className="demo-editor-pane" ref={editorPaneRef}>
          <p className="demo-source">
            Loaded from <code>{CORPUS_PATH}{fixture.name}.md</code>
          </p>
          <Editor
            key={seed.n}
            initialContent={seed.text}
            onChange={onEditorChange}
            annotationKinds={ANNOTATION_KINDS}
            annotations={annotations}
            activeAnnotationId={activeId}
            onCreateAnnotation={handleCreate}
            onActivateAnnotation={setActiveId}
          />
        </div>

        {/* The round-trip claim (FR-001, SC-001): what you type on the left is
            exactly the markdown that would land on disk, shown live on the
            right. `markdown` is `onChange`'s output — nothing in this pane is
            re-derived or reformatted, it is the literal string the editor
            produced. */}
        <div className="demo-markdown-pane">
          <h2>Markdown output</h2>
          {/* Editable. Typing here re-imports into the editor once you pause,
              so the round trip can be driven from either side.

              Lines do not wrap (`wrap="off"`, horizontal scroll instead): a
              textarea cannot be split into per-line rows, so the gutter can
              only stay aligned if one source line is one visual row. That also
              removes the wrap-versus-newline ambiguity the numbers were added
              to resolve — a wrap can no longer occur. */}
          <div className="demo-md-editor">
            <div className="demo-md-gutter" aria-hidden="true">
              <div ref={gutterRef}>
                {raw.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
            </div>
            <textarea
              ref={markdownPreRef}
              className="demo-md-input"
              value={raw}
              onChange={onRawChange}
              onScroll={onRawScroll}
              onFocus={() => { rawFocused.current = true }}
              onBlur={() => { rawFocused.current = false }}
              spellCheck={false}
              wrap="off"
              aria-label="Markdown source"
            />
          </div>
        </div>
      </main>

      <aside className="demo-sidebar">
        <section>
          <h2>Outline</h2>
          <p className="demo-hint">Built with <code>@liminis/editor/markdown</code> — no editor involved.</p>
          <ul className="demo-outline">
            {headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.depth - 1) * 12}px` }}>
                <button type="button" className="demo-outline-link" onClick={() => scrollToHeading(i)}>
                  {h.text}
                </button>
              </li>
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

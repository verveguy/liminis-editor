# Annotations

An **annotation** is a range-anchored marker over document text whose anchor
survives edits to the surrounding document.

Comments and corrections are not separate features here. They are two *kinds*,
differing only by the configuration record a host supplies. If you are building
something that marks up a passage and hangs your own domain object off it, you
are configuring a kind.

## The seam

The package owns anchor mechanics and marker rendering. Identity, storage and
lifecycle stay in your application:

- `id` is **opaque** to the package. You mint it and you persist it.
- `payload` is **carried through untouched** and handed back on activation, so
  you can round-trip your own domain object without the package understanding it.
- Resolution outcomes are **computed by you** — via `resolveAnchors` or your own
  store. The package never classifies on your behalf.

## Turning it on

Supplying `annotationKinds` is the switch. With it absent, no annotation module
is loaded, no command is registered and nothing renders — the surface sits
behind a `React.lazy()` boundary, so it is not in the chunk your app downloads.

```tsx
<Editor
  initialContent={markdown}
  onChange={setMarkdown}
  annotationKinds={{
    comment: {
      markerStyle: 'highlight',
      createAffordance: { surface: 'toolbar', label: 'Comment' },
      retainMarkOnCreate: true,
    },
  }}
  annotations={annotations}
  activeAnnotationId={activeId}
  onCreateAnnotation={handleCreate}
  onActivateAnnotation={setActiveId}
/>
```

### `AnnotationKindConfig`

| Field | Type | Meaning |
|---|---|---|
| `markerStyle` | `'highlight' \| 'squiggle' \| 'none'` | How the kind paints. `none` places no visible marker at all — used by kinds that adopt the anchor model but render nothing themselves. |
| `createAffordance` | `{ surface: 'toolbar' \| 'contextMenu', label?: string, icon?: unknown } \| null` | Where a user-initiated create action is offered. Omit or `null` for host-injected annotations only. |
| `livemarkPolicy` | `(annotation) => boolean` | Whether an annotation gets a live `MarkNode` in the document. Defaults to `shouldPlaceLiveMark(outcome)`. Consulted only when `markerStyle` is not `none`. |
| `retainMarkOnCreate` | `boolean` | Whether the transient capture mark stays after an anchor is captured. A composer that highlights the passage wants `true`; a kind that captures and dismisses wants `false`. |

`AnnotationKindConfigs` is `Record<string, AnnotationKindConfig>`. Kind names are
plain strings — the package has no closed set and gives no kind special status.

`createAffordance.icon` is consulted only on the `toolbar` surface, where it
replaces the affordance button's plain-text `label` as its *visible* content
(fitting the existing 32×32 `.toolbar-button` box). It never affects the
button's *accessible name* — `aria-label`/`title` always derive from `label`,
so a host's existing `getByRole('button', { name: label })` query keeps
working whether or not `icon` is supplied. It is typed `unknown` in
`src/annotations/types.ts` (the headless `./annotations` subpath cannot
import `react`), so a React host supplies a `ReactNode` (e.g. a
`lucide-react` icon element) and `Toolbar` casts it back at render time. The
`contextMenu` surface does not consult `icon` at all.

```tsx
createAffordance: { surface: 'toolbar', label: 'Comment', icon: <MessageSquareIcon size={16} /> },
```

### `Annotation`

```ts
interface Annotation<TPayload = unknown> {
  id: string
  kind: string
  anchor: Anchor
  outcome?: 'unchanged' | 're-attached' | 'flagged' | 'orphaned'   // default 'unchanged'
  presentation?: { className?: string; label?: string }
  payload?: TPayload
}
```

## Anchors

```ts
import { captureAnchor, resolveAnchors, ANCHOR_SCHEMA } from '@liminis/editor/annotations'
```

This subpath is DOM-, React- and Lexical-free, so anchors can be captured,
stored and resolved anywhere — a server, a worker, an Electron main process, a
test with no DOM. (It does depend on `zod`, which is why it is a subpath of its
own rather than part of `./markdown`.)

### Capture

```ts
const anchor = captureAnchor(documentText, { start, end }, docVersion)
```

An anchor stores the quoted text plus `CONTEXT_WINDOW_CHARS` (40) of surrounding
context on each side, along with structural context and the document version it
was captured against. `ANCHOR_SCHEMA` and `ANCHOR_RESOLUTION_SCHEMA` are zod
schemas for persisting them.

### Resolution

When the document changes, re-resolve:

```ts
const result = await resolveAnchors(anchors, newDocumentText, newDocumentVersion)
```

Each anchor lands in one of four outcomes:

| Outcome | Meaning | Live mark placed? |
|---|---|---|
| `unchanged` | The exact range still matches | yes |
| `re-attached` | Found at a new offset, similarity ≥ `REATTACH_THRESHOLD` (0.6) | yes |
| `flagged` | A candidate exists but is uncertain, similarity ≥ `FLAG_THRESHOLD` (0.35) | no — panel only |
| `orphaned` | Nothing matches | no — nothing left to point at |

`flagged` and `orphaned` deliberately get no in-document mark: one would be
pointing at text that may not be the right text, the other at nothing. Both stay
visible in whatever panel your app renders. `shouldPlaceLiveMark(outcome)`
encodes this, and `deriveMarkerTargets` applies it across a set.

`resolveAnchor` handles a single anchor. `similarity(a, b)` is the scoring
function, exported so you can reuse the same measure in your own UI.

### Semantic relocation

`resolveAnchors` accepts an optional `proposeSemanticRelocation` seam: an
async function that gets a chance to relocate an anchor the textual matcher
could not place — an LLM call, typically. `noopProposeSemanticRelocation` is the
default and returns `null`, so nothing is relocated unless you opt in.

## Marker styling

Markers are styled by `@liminis/editor/styles.css` (the `annotation-mark-*`
rules). **If you do not import that stylesheet, markers are invisible** — the
mark nodes are placed in the document, they just have no appearance. Nothing
errors. This is the single most likely reason "annotations don't work" for a new
consumer.

Per-annotation overrides go through `presentation.className`, which is applied
to that annotation's marker element in addition to the kind's own class.

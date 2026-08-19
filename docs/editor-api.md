# `<Editor>` and the host seam

## `<Editor>`

```tsx
import { Editor } from '@liminis/editor'
```

The editor takes markdown in and hands markdown back. Lexical state is an
implementation detail you never have to touch.

### Content

| Prop | Type | Notes |
|---|---|---|
| `initialContent` | `string` | Markdown text. **Required.** |
| `onChange` | `(markdown: string) => void` | Fires on edit with the serialized markdown. **Required.** |
| `contentVersion` | `number` | Bump to force a re-import of `initialContent`. Without it, changing `initialContent` alone does not reload the document — that is deliberate, so a controlled `onChange` loop does not fight the user's cursor. |
| `editable` | `boolean` | Default `true`. `false` renders read-only. A `toolbar`-surfaced annotation create affordance (see the Annotations section of the package README) remains reachable via selection either way; formatting controls do not render when read-only. |
| `filePath` | `string` | The path of the file being edited. Drives file-type-specific UI (e.g. `.mdc`). |

### Cursor and selection

| Prop | Type | Notes |
|---|---|---|
| `cursorToRestoreRef` | `RefObject<CursorState \| null>` | A ref, not a value — it is read inside effects, not during render, so restoring a cursor never triggers a render pass. |
| `onCursorChange` | `(cursor: CursorState) => void` | Fires as the caret moves. Pair with `cursorToRestoreRef` to persist cursor position across document switches. |
| `onSelectionContextMenu` | `(event: SelectionContextMenuEvent) => void` | Fires on context menu over a selection. Your app renders the menu. |

### Assets and links

| Prop | Type | Notes |
|---|---|---|
| `assetBaseUri` | `string` | Base URI images resolve against. |
| `documentDirUri` | `string` | URI of the directory containing the document, for relative-path resolution. |
| `imagePathResolution` | `ImagePathResolution` | How relative image paths are interpreted. |
| `resolveLocalAsset` | `(relativePath: string) => Promise<string \| null>` | Resolve a workspace-relative path to a data URL. Return `null` for "not found" — the editor renders a broken-image placeholder rather than throwing. |

### Corrections

| Prop | Type | Notes |
|---|---|---|
| `onSubstitutionDetected` | `(oldTerm: string, newTerm: string) => void` | Fires after a debounce when a single-word substitution is detected. |
| `sweepRef` | `MutableRefObject<SweepFn \| null>` | Populated with a sweep function while the ambient-correction plugin is active. |

### Annotations

All optional; supplying `annotationKinds` is what turns the mechanism on. See
[`annotations.md`](./annotations.md).

| Prop | Type | Notes |
|---|---|---|
| `annotationKinds` | `AnnotationKindConfigs` | Per-kind configuration. Omit it and no annotation module is loaded. |
| `annotations` | `Annotation[]` | Host-supplied annotations to render markers for, already resolved. |
| `activeAnnotationId` | `string \| null` | Which annotation is active, for marker styling. |
| `scrollToAnnotation` | `{ id: string; nonce: number } \| null` | Host-driven scroll signal. Bump `nonce` to re-scroll to the same id. |
| `onCreateAnnotation` | `(event: AnnotationCreateEvent) => void` | Fires when a user creates one via a kind's create affordance. |
| `onActivateAnnotation` | `(id: string) => void` | Fires when a marker is activated. Your app opens its own panel. |
| `annotationEditorHandleRef` | `MutableRefObject<AnnotationEditorHandle \| null>` | Imperative handle for the mounted editor's live marks: `removeMarksForAnnotation`, `collectLiveAnchorSnapshots`, and `getMarkRects(annotationIds?)` — current on-screen `DOMRect[]` per annotation id (one rect per constituent mark, omitted ids means "every live annotation"), for a host positioning UI against annotated text. |
| `annotationLogger` | `{ warn(message, ...args): void }` | Injected, so the package never imports a host logger. |

## Document outline

A live, navigable "on this page" heading list (issue #69) — `<Editor>` owns
the Lexical document and its heading DOM, so the package derives entries and
implements scroll-to-heading; you decide whether, where, and how the outline
is shown.

```tsx
import { useState } from 'react'
import { Editor, DocumentOutline, createDocumentOutlineHandle } from '@liminis/editor'

function MyEditorWithOutline() {
  // Create once per editor instance — the same object connects the two
  // components. A second editor on the same page needs its own handle.
  const [outlineHandle] = useState(() => createDocumentOutlineHandle())

  return (
    <div style={{ display: 'flex' }}>
      <Editor
        initialContent={markdown}
        onChange={setMarkdown}
        documentOutlineHandle={outlineHandle}
      />
      <aside>
        <DocumentOutline handle={outlineHandle} />
      </aside>
    </div>
  )
}
```

| Prop | Type | Notes |
|---|---|---|
| `<Editor>`'s `documentOutlineHandle` | `DocumentOutlineHandle` | Connects this editor instance to a `<DocumentOutline>`. Omit it and no outline plugin mounts at all — an outline-less consumer pays nothing for it. |
| `<DocumentOutline>`'s `handle` | `DocumentOutlineHandle` | The same object passed to `<Editor>`. |
| `<DocumentOutline>`'s `className` | `string` | Additional class on the outer `<nav>`, for your own placement/layout. |

`createDocumentOutlineHandle()` returns the shared controller: a React
external store (`subscribe`/`getSnapshot`, so `<DocumentOutline>` re-renders
live as the reader scrolls and the document changes) plus an imperative
`scrollToHeading(index)`. You never call its methods directly — `<Editor>`
feeds it, `<DocumentOutline>` reads it.

- Entries are H1–H5 headings in document order, indented by level, with
  inline formatting (including inline code) reduced to plain text. Identity
  is by position, not text, so duplicate headings are handled correctly.
- The active entry — the heading at the top of the viewport — is tracked as
  the reader scrolls and kept visible within the outline itself.
- `<DocumentOutline>` renders nothing when the document has no headings.
- Visibility, placement, width-gating, and any collapse/persistence are
  entirely up to you — `<DocumentOutline>` imposes no layout policy.

Most consumers embed this package via `<App>`, not `<Editor>` directly —
`<App>` forwards `documentOutlineHandle` straight through to its inner
`<Editor>`, so the same handle wires up an outline there too:

```tsx
import { useState } from 'react'
import { App, DocumentOutline, createDocumentOutlineHandle } from '@liminis/editor'

function MyAppWithOutline() {
  const [markdown, setMarkdown] = useState('# Introduction')
  const [outlineHandle] = useState(() => createDocumentOutlineHandle())

  return (
    <div style={{ display: 'flex' }}>
      <App
        content={markdown}
        onChange={setMarkdown}
        documentOutlineHandle={outlineHandle}
      />
      <aside>
        <DocumentOutline handle={outlineHandle} />
      </aside>
    </div>
  )
}
```

## The host seam

The package boundary is drawn at **persistence**: text ranges, marks, rendering
and in-document UX are the package's; storage, lifecycle, identity and
higher-level panels are yours. Everything the package needs from you crosses
that seam through `EditorHostServices`.

Every member is optional and has a safe default, so `<Editor>` works with no
provider at all. Wrap it when you want to supply real services:

```tsx
import { EditorHostProvider, Editor } from '@liminis/editor'

<EditorHostProvider services={{ logger, bridge, resolveWikiLinks, notifyError }}>
  <Editor initialContent={md} onChange={setMd} />
</EditorHostProvider>
```

### `EditorHostServices`

| Member | Type | Purpose |
|---|---|---|
| `bridge` | `EditorHostBridge` | The channel to your environment. Two methods only: `postMessage(message)` and `addMessageHandler(handler)` returning an unsubscribe. Every higher-level helper (`requestInit`, `applyTextEdits`, `writeAsset`, `openLink`) is built on `postMessage` inside the package, so every host adapter emits byte-identical payloads. Defaults to a no-op bridge. |
| `logger` | `(namespace: string) => EditorLogger` | Namespaced logger factory. `EditorLogger` is `{ debug, info, warn, error }`, structurally compatible with most app loggers. |
| `resolveWikiLinks` | `(targets: string[]) => Promise<Record<string, string \| null>>` | Map wiki-link targets to existing paths; `null` for unresolved. Drives the "this page does not exist yet" styling. |
| `onScrollToAnchor` | `(cb: (anchor: string) => void) => () => void` | Subscribe to host-driven scroll requests. Returns an unsubscribe. |
| `notifyError` | `(message: string, description?: string) => void` | Surface a user-visible error. Defaults to a console warning. |
| `corrections` | `CorrectionHostServices` | Persistence and knowledge-graph services backing the correction feature: `readCorrections`, `writeCorrections`, `suggestEntities`, `suggestPassages`, `applyCorrections`. The in-editor correction UI is package-side; the file and the graph are yours. |

Read the resolved set inside your own components with `useEditorHost()`.
`resolveHostServices()` applies the defaults if you need them directly.

### The message contract

`@liminis/editor/contract` exports the `HostToUIMessage` / `UIToHostMessage`
shapes and nothing else. It exists so a boundary that must not pull renderer
code into its bundle — an Electron preload script is the canonical case — can
name the message types.

```ts
import type { HostToUIMessage, UIToHostMessage } from '@liminis/editor/contract'
```

Use `import type`. A value import from this entry pulls in `zod`, which is
exactly what the entry exists to avoid.

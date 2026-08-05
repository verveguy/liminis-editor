/**
 * Arm 2 — a consumer that mounts `<Editor>` and configures no annotation kinds.
 *
 * Paired with `annotations-on.tsx`, this is FR-006's measurement. What is
 * asserted is that no annotation-specific module is present in the chunks this
 * arm loads eagerly: `AnnotationSurface` sits behind a `React.lazy()` boundary
 * (a separate async chunk that is never requested when no kind is configured),
 * and this arm never reaches for `@liminis/editor/annotations` at all.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@liminis/editor'
import '@liminis/editor/styles.css'

function BareEditor() {
  const [markdown, setMarkdown] = useState('# Bare editor\n\nNo annotation kinds configured.\n')
  return <Editor initialContent={markdown} onChange={setMarkdown} />
}

const host = document.getElementById('root')
if (host) createRoot(host).render(<BareEditor />)

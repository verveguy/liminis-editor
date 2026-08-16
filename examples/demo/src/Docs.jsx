/**
 * The public site's documentation view (verveguy/liminis-editor#3,
 * FR-005–FR-009): the root README.md, rendered verbatim.
 *
 * `./docs-content.generated.js` is not hand-written content — it is
 * generated from README.md by `scripts/generate-demo-docs.mjs` and
 * gitignored, so this file never carries a second, drifting copy of the
 * exports/peer-deps/sideEffects/versioning/annotations documentation that
 * README.md already states once.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { readme } from './docs-content.generated.js'

export function Docs() {
  return (
    <div className="demo-docs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
    </div>
  )
}

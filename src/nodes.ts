/**
 * `@liminis/editor/nodes` — the headless mapper surface (#954).
 *
 * The seventh declared export subpath, added as a *considered* export under
 * ADR-075's "closed set of declared subpaths" rule (same pattern ADR-077 used
 * to add `./annotations`). It exists because no existing subpath's isolation
 * contract fits: `importMarkdownToLexical`/`exportLexicalToMdast` instantiate
 * Lexical node classes directly, so any entry point exporting them — or the
 * node array a consumer needs to construct a matching `createEditor` — must
 * itself permit Lexical. `./markdown`, `./headless`, `./contract` and
 * `./annotations` are all documented and tested as Lexical-free, and the root
 * barrel (`.`) pulls in the full `<App>`/`<Editor>` React surface (Prism,
 * Mermaid's render path, the C4 subsystem) this subpath exists to avoid.
 *
 * `editorNodes` is re-exported from the same module `Editor.tsx` configures
 * its own `LexicalComposer` with (`./app/editor/editorNodes`) — not a
 * separately hand-maintained copy — so adding a node type to the production
 * editor updates this export automatically (FR-002).
 *
 * **Known exception, carried over from `./headless`: MathJax-lite.**
 * `EquationNode` imports `mathjax-config` at module scope, which statically
 * imports MathJax's lite *and* browser adaptors. Loading this subpath
 * therefore evaluates ~90 side-effectful MathJax TeX-configuration imports —
 * no DOM, no rendering, no MathJax document instantiation. This is not new
 * weight introduced by this subpath; `./headless` already carries the
 * identical exception for the same reason. Splitting `EquationNode`'s import
 * into lazy/eager halves is a real fix but a separate refactor, out of scope
 * for this purely-additive change.
 *
 * A consumer builds a headless editor for testing like:
 *
 * ```ts
 * import { createEditor } from 'lexical'
 * import { editorNodes, importMarkdownToLexical, exportLexicalToMdast } from '@liminis/editor/nodes'
 * import { parseMarkdown } from '@liminis/editor/markdown'
 *
 * const editor = createEditor({ namespace: 'test', nodes: editorNodes, onError: (e) => { throw e } })
 * const parsed = parseMarkdown(markdownSource)
 * editor.update(() => importMarkdownToLexical(editor, parsed.root), { discrete: true })
 * const mdast = exportLexicalToMdast(editor)
 * ```
 */

export { editorNodes } from './app/editor/editorNodes'
export { importMarkdownToLexical, exportLexicalToMdast } from './app/mapper'

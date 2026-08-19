#!/usr/bin/env node
/**
 * Shared extraction logic for the `App`↔`Editor` prop-forwarding contract
 * (verveguy/liminis-editor#80).
 *
 * Issue #69 added `documentOutlineHandle` to `EditorProps` but not to
 * `AppProps`, leaving it exported yet structurally unreachable for the `<App>`
 * consumers most callers actually embed (Zusammen mounts `App`, not `Editor`
 * directly). That is a class of bug, not one prop: nothing stopped the same
 * gap recurring for the next member added to `EditorProps`. This module is
 * the extraction half of the guard that closes the class — `tests/editor-app-
 * forwarding-contract.test.ts` uses it to assert every `EditorProps` member is
 * either wired into the `<Editor .../>` JSX call inside `App`'s render body,
 * or listed in `EDITOR_INTERNAL_PROPS` below with a reason.
 *
 * Checking JSX-attribute presence (not just `AppProps` interface-member
 * presence) is deliberate: a prop declared on `AppProps` but never passed to
 * `<Editor>` would satisfy a weaker "is it on the type" check while leaving
 * the capability exactly as unreachable as `documentOutlineHandle` was.
 *
 * Every function here is pure and takes its input source text explicitly, so
 * both the real repo files and a throwaway fixture (mutation tests) can be
 * pointed at it.
 */

/** Strip `//` and `/* ... *\/` comments from TS/TSX text, comment-aware. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Every top-level member name declared directly inside `interface
 * <interfaceName> { ... }` in `source` — not members of a nested inline
 * type (e.g. `scrollToAnnotation?: { id: string; nonce: number } | null`
 * contributes only `scrollToAnnotation`, not `id`/`nonce`).
 *
 * Assumes every member is declared on a single line, which holds for every
 * current `EditorProps`/`AppProps` member even where its type contains
 * nested braces or generics — brace-depth tracking only needs to establish
 * "am I at interface top level," not parse the nested type. A future
 * multi-line member declaration would need this extended.
 */
export function extractInterfaceMembers(source, interfaceName) {
  const stripped = stripComments(source)
  const declRe = new RegExp(`interface\\s+${interfaceName}\\b[^{]*\\{`)
  const match = declRe.exec(stripped)
  if (!match) return []

  const bodyStart = match.index + match[0].length
  let depth = 1
  let i = bodyStart
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === '{') depth++
    else if (stripped[i] === '}') depth--
    i++
  }
  const body = stripped.slice(bodyStart, i - 1)

  const memberRe = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/
  const members = []
  let lineDepth = 0
  for (const line of body.split('\n')) {
    if (lineDepth === 0) {
      const m = memberRe.exec(line)
      if (m) members.push(m[1])
    }
    for (const ch of line) {
      if (ch === '{') lineDepth++
      else if (ch === '}') lineDepth--
    }
  }
  return members
}

/**
 * Every attribute name passed via `attr={expr}` on the first
 * `<elementName ... />` JSX element found in `source`. Brace-depth aware so
 * an attribute value containing `>` (e.g. an arrow function) doesn't
 * prematurely end the tag scan.
 *
 * Assumes `attr={localVar}` syntax throughout the tag, not JSX shorthand
 * spread (`{...props}`) — true of the current `<Editor .../>` call in
 * `App.tsx`. A future refactor introducing a spread would need this
 * extended.
 */
export function extractJsxAttributes(source, elementName) {
  const stripped = stripComments(source)
  const openRe = new RegExp(`<${elementName}(?=[\\s/>])`)
  const match = openRe.exec(stripped)
  if (!match) return []

  let i = match.index + match[0].length
  let depth = 0
  let end = -1
  while (i < stripped.length) {
    const ch = stripped[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (depth === 0 && ch === '/' && stripped[i + 1] === '>') {
      end = i
      break
    } else if (depth === 0 && ch === '>') {
      end = i
      break
    }
    i++
  }
  if (end === -1) return []

  const tagBody = stripped.slice(match.index + match[0].length, end)
  const attrRe = /(\w+)=\{/g
  const attrs = []
  let m
  while ((m = attrRe.exec(tagBody))) attrs.push(m[1])
  return attrs
}

/**
 * `EditorProps` members that are intentionally not forwarded on `AppProps`,
 * with the reason each can't be a plain pass-through — `App` sources or
 * derives them from its own IPC/internal state in both its IPC-driven and
 * inline (`content`/`onChange`) modes (verveguy/liminis-editor#80 FR-002).
 * Add an entry here, with a reason, for any future `EditorProps` member that
 * is legitimately App-internal rather than forwarding it.
 */
export const EDITOR_INTERNAL_PROPS = {
  initialContent:
    "Renamed to App's `content` prop, then multiplexed with IPC-sourced state " +
    '(`internalContent`, fed by `DOC_INIT`/`DOC_CHANGED`) before reaching `<Editor>` ' +
    "as its `initialContent` — reachable via `content`, but not a same-name pass-through.",
  contentVersion:
    'App owns this counter for its own cursor-restore bookkeeping across content ' +
    'reloads; not a value a caller supplies.',
  cursorToRestoreRef:
    "App owns `cursorStateRef` and supplies it internally as this prop's value; not " +
    'exposed for a caller to supply their own.',
  onCursorChange:
    "App supplies its own `handleCursorChange`, which only writes to App's internal " +
    'cursorStateRef; no App-level prop re-exposes cursor-change notifications to a caller.',
  assetBaseUri:
    'Sourced exclusively from IPC `DOC_INIT`/`DOC_CHANGED` state; stays `undefined` in ' +
    'inline mode, with no App-level pass-through in either mode.',
  documentDirUri:
    'IPC-derived, with an inline-mode fallback computed from `filePath` — sourced or ' +
    'derived from App state in both modes, never a caller-supplied prop.',
  imagePathResolution:
    'Sourced from `settings?.imagePathResolution` (IPC `SETTINGS_CHANGED`/`DOC_INIT`), ' +
    'defaulted internally; not caller-supplied.',
}

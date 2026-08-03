/**
 * `@liminis/editor/contract` — the host-message contract, and nothing else.
 *
 * A DOM- and React-free entry point so a preload script (or any other boundary
 * that must not pull renderer code into its bundle) can `import type` the
 * message shapes without dragging in Lexical.
 */

export * from './types'

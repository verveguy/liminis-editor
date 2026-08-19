/**
 * The `App`↔`Editor` prop-forwarding contract (verveguy/liminis-editor#80).
 *
 * Most consumers embed this package via `<App>`, not `<Editor>` directly
 * (Zusammen mounts `App`). `App` forwards a curated, hand-maintained subset
 * of `EditorProps` as `AppProps`. Issue #69 added `documentOutlineHandle` to
 * `EditorProps` but not `AppProps`, so `<App>` consumers had no way to reach
 * it — exported from the package, yet structurally unreachable through the
 * component most consumers actually use.
 *
 * This suite is the guard that closes that class of bug, not just that one
 * prop: it asserts every `EditorProps` member is either an attribute on the
 * `<Editor .../>` JSX element inside `App`'s render body (i.e. it actually
 * reaches the editor, not merely "is declared on `AppProps`'s type" — a
 * prop could satisfy the weaker check while never being wired into the JSX
 * call, exactly as unreachable as `documentOutlineHandle` was), or is listed
 * in `EDITOR_INTERNAL_PROPS` with a reason it is intentionally App-internal.
 *
 * All failure modes are demonstrated by mutation below, not merely asserted
 * to work, in the style of `theming-contract.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractInterfaceMembers,
  extractJsxAttributes,
  EDITOR_INTERNAL_PROPS,
} from '../scripts/lib/editor-app-prop-forwarding.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_TSX_PATH = resolve(REPO_ROOT, 'src', 'app', 'editor', 'Editor.tsx');
const APP_TSX_PATH = resolve(REPO_ROOT, 'src', 'app', 'App.tsx');

function editorSource(): string {
  return readFileSync(EDITOR_TSX_PATH, 'utf-8');
}

function appSource(): string {
  return readFileSync(APP_TSX_PATH, 'utf-8');
}

function editorPropsMembers(): string[] {
  return extractInterfaceMembers(editorSource(), 'EditorProps');
}

function editorJsxAttributes(): string[] {
  return extractJsxAttributes(appSource(), 'Editor');
}

describe('editor/app forwarding contract: extraction finds something to check', () => {
  it('finds EditorProps members and <Editor .../> JSX attributes to compare', () => {
    // Anti-vacuity: if either side is empty, the diff assertion below would
    // pass trivially without checking anything.
    expect(
      editorPropsMembers().length,
      'found no members on EditorProps in src/app/editor/Editor.tsx; the guard would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      editorJsxAttributes().length,
      'found no attributes on the <Editor .../> element in src/app/App.tsx; the guard would be vacuous',
    ).toBeGreaterThan(0);
  });
});

describe('editor/app forwarding contract: every EditorProps member is reachable through App', () => {
  it('is forwarded on the <Editor .../> JSX call, or listed as intentionally App-internal', () => {
    const members = editorPropsMembers();
    const jsxAttrs = new Set(editorJsxAttributes());
    const internal = new Set(Object.keys(EDITOR_INTERNAL_PROPS));

    const unclassified = members.filter((name) => !jsxAttrs.has(name) && !internal.has(name));

    expect(
      unclassified,
      'EditorProps member(s) neither forwarded to <Editor> in App.tsx nor listed in ' +
        'EDITOR_INTERNAL_PROPS (scripts/lib/editor-app-prop-forwarding.mjs) with a reason — ' +
        'this is the class of bug #80 fixes: a capability exported from EditorProps but ' +
        'unreachable through <App>.',
    ).toEqual([]);
  });

  it('has a non-empty reason for every EDITOR_INTERNAL_PROPS entry', () => {
    const empty = Object.entries(EDITOR_INTERNAL_PROPS)
      .filter(([, reason]) => !reason?.trim())
      .map(([name]) => name);

    expect(
      empty,
      'EDITOR_INTERNAL_PROPS entry with no reason string — every intentionally-internalized ' +
        'prop must record why it cannot be a plain pass-through',
    ).toEqual([]);
  });

  it('lists no EDITOR_INTERNAL_PROPS entry that is not actually an EditorProps member', () => {
    // Guards against the allowlist drifting stale after a prop is renamed or removed
    // from EditorProps — a leftover entry would otherwise silently widen what counts
    // as "classified" without corresponding to anything real.
    const members = new Set(editorPropsMembers());
    const stale = Object.keys(EDITOR_INTERNAL_PROPS).filter((name) => !members.has(name));

    expect(stale, 'EDITOR_INTERNAL_PROPS entry that no longer names an EditorProps member').toEqual(
      [],
    );
  });
});

describe('editor/app forwarding contract: mutation tests (the guard actually fires)', () => {
  const FIXTURE_EDITOR_SOURCE = `
    interface EditorProps {
      initialContent: string;
      autoFocus?: boolean;
      documentOutlineHandle?: DocumentOutlineHandle;
      /** deliberately unforwarded and unallowlisted */
      newConsumerFacingProp?: string;
    }
  `;

  it('flags a new EditorProps member that is neither forwarded nor allowlisted', () => {
    const members = extractInterfaceMembers(FIXTURE_EDITOR_SOURCE, 'EditorProps');
    const jsxAttrs = new Set(['initialContent', 'autoFocus', 'documentOutlineHandle']);
    const internal = new Set(Object.keys({ initialContent: 'renamed to content' }));

    const unclassified = members.filter((name) => !jsxAttrs.has(name) && !internal.has(name));

    expect(unclassified).toEqual(['newConsumerFacingProp']);
  });

  it('does not flag a member once it is forwarded', () => {
    const members = extractInterfaceMembers(FIXTURE_EDITOR_SOURCE, 'EditorProps');
    const jsxAttrs = new Set([
      'initialContent',
      'autoFocus',
      'documentOutlineHandle',
      'newConsumerFacingProp',
    ]);
    const internal = new Set<string>();

    const unclassified = members.filter((name) => !jsxAttrs.has(name) && !internal.has(name));

    expect(unclassified).toEqual([]);
  });

  it('does not flag a member once it is added to the internal-props allowlist', () => {
    const members = extractInterfaceMembers(FIXTURE_EDITOR_SOURCE, 'EditorProps');
    const jsxAttrs = new Set(['initialContent', 'autoFocus', 'documentOutlineHandle']);
    const internal = new Set(['newConsumerFacingProp']);

    const unclassified = members.filter((name) => !jsxAttrs.has(name) && !internal.has(name));

    expect(unclassified).toEqual([]);
  });

  it('does not mistake a nested inline-type field for a top-level EditorProps member', () => {
    const fixture = `
      interface EditorProps {
        scrollToAnnotation?: { id: string; nonce: number } | null;
      }
    `;
    expect(extractInterfaceMembers(fixture, 'EditorProps')).toEqual(['scrollToAnnotation']);
  });

  it('extracts only attributes on the named element, ignoring an unrelated JSX tag', () => {
    const fixture = `
      <EditorHostProvider services={services}>
        <Editor initialContent={content} autoFocus={autoFocus} onChange={onChange} />
      </EditorHostProvider>
    `;
    expect(extractJsxAttributes(fixture, 'Editor')).toEqual([
      'initialContent',
      'autoFocus',
      'onChange',
    ]);
  });
});

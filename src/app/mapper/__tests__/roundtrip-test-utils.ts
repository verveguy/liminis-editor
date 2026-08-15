/**
 * Shared test-support helpers for round-trip (markdown -> Lexical -> markdown) tests.
 *
 * Exercises the real production pipeline: parseMarkdown -> importMarkdownToLexical ->
 * exportLexicalToMdast -> stringifyMarkdown. Used both by footnote-collection.test.ts
 * and by the fixture-driven corpus in fixture-roundtrip.test.ts.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createEditor, LexicalEditor, LexicalNode, $getRoot, $isElementNode } from 'lexical';
import { registerList } from '@lexical/list';
import { parseMarkdown } from '../../../markdown/parse';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { importMarkdownToLexical } from '../mdastToLexical';
import { exportLexicalToMdast, type ExportOptions } from '../lexicalToMdast';
import { createTwoFilesPatch } from 'diff';
import { editorNodes } from '../../editor/editorNodes';

// Re-exported for the ~15 internal test files that import the production
// node set from here (#954: single source of truth is `../../editor/editorNodes`).
export { editorNodes };

export function createTestEditor(
  onError?: (error: Error) => void,
  registerListPlugin = false,
): { editor: LexicalEditor; dispose: () => void } {
  const editor = createEditor({
    namespace: 'test',
    nodes: editorNodes,
    onError:
      onError ??
      ((error) => {
        throw error;
      }),
  });

  // The production editor registers <ListPlugin /> (Editor.tsx), which calls
  // @lexical/list's registerList() to install ListNode/ListItemNode transforms
  // that run on every editor.update(). The plain harness above doesn't install
  // these, so opt in here to verify the fix survives them too — see
  // list-item-block-content.test.ts. registerList() returns a disposer that
  // unregisters those transforms/commands; callers should invoke it once
  // they're done with the editor instance.
  const dispose = registerListPlugin ? registerList(editor) : () => {};

  return { editor, dispose };
}

/**
 * Round-trip helper: markdown -> Lexical -> MDAST -> markdown
 * Returns both intermediate MDAST and final markdown for inspection.
 *
 * The "[edit]" step of the production pipeline is exercised as an identity
 * operation (no mutation applied) — see spec Assumptions for #896.
 */
export function roundTrip(
  markdown: string,
  options: { registerListPlugin?: boolean; exportOptions?: ExportOptions } = {},
): Promise<{ mdast: ReturnType<typeof exportLexicalToMdast>; output: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: () => void = () => {};
    const settleResolve = (value: { mdast: ReturnType<typeof exportLexicalToMdast>; output: string }) => {
      if (settled) return;
      settled = true;
      dispose();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      dispose();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    try {
      // Lexical may route an error thrown during editor.update() (e.g. from
      // importMarkdownToLexical) through onError instead of letting it
      // propagate to the surrounding try/catch below — reject directly here
      // so the promise always settles regardless of which path Lexical takes.
      const created = createTestEditor((error) => settleReject(error), options.registerListPlugin ?? false);
      const editor = created.editor;
      dispose = created.dispose;
      const parsed = parseMarkdown(markdown);

      editor.update(
        () => {
          importMarkdownToLexical(editor, parsed.root);
        },
        {
          discrete: true,
          onUpdate: () => {
            try {
              const mdast = exportLexicalToMdast(editor, options.exportOptions);
              const output = stringifyMarkdown(mdast);
              settleResolve({ mdast, output });
            } catch (error) {
              settleReject(error);
            }
          },
        },
      );
    } catch (error) {
      settleReject(error);
    }
  });
}

function walkNodeTypes(node: LexicalNode, types: Set<string>): void {
  types.add(node.getType());
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      walkNodeTypes(child, types);
    }
  }
}

/**
 * Imports `markdown` through the real production pipeline (parseMarkdown ->
 * importMarkdownToLexical) and returns the set of Lexical node-type strings
 * (`getType()`) constructed anywhere in the resulting tree. Used by the node-class
 * completeness test to determine which editor node classes the fixture corpus
 * actually exercises — this deliberately inspects the imported Lexical tree rather
 * than the exported mdast/markdown, since two distinct node classes (e.g.
 * CalloutNode and QuoteNode) can export to the same mdast shape.
 */
export function collectImportedNodeTypes(markdown: string): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose: () => void = () => {};
    const settleResolve = (value: Set<string>) => {
      if (settled) return;
      settled = true;
      dispose();
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      dispose();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    try {
      const created = createTestEditor((error) => settleReject(error));
      const editor = created.editor;
      dispose = created.dispose;
      const parsed = parseMarkdown(markdown);

      editor.update(
        () => {
          importMarkdownToLexical(editor, parsed.root);
        },
        {
          discrete: true,
          onUpdate: () => {
            try {
              const types = new Set<string>();
              editor.getEditorState().read(() => {
                walkNodeTypes($getRoot(), types);
              });
              settleResolve(types);
            } catch (error) {
              settleReject(error);
            }
          },
        },
      );
    } catch (error) {
      settleReject(error);
    }
  });
}

/** A single fixture discovered on disk, with its optional companion sidecar files. */
export interface FixtureEntry {
  /** Human-readable name for the fixture, e.g. "known-defects/897-list-item-code-block" */
  name: string;
  /** Absolute path to the fixture's .md input file */
  path: string;
  /** Raw markdown content of the fixture */
  input: string;
  /** Companion expected-output content, if a `<name>.expected.md` sidecar exists */
  expected: string | null;
  /** Expected error message substring, if a `<name>.error.txt` sidecar exists */
  expectedError: string | null;
  /**
   * Reason a fixture is exempt from the second-pass idempotence assertion, if a
   * `<name>.idempotence-exempt.txt` sidecar exists. Reserved for pre-existing,
   * documented normalizations that are themselves non-idempotent and out of scope
   * for the idempotence guarantee (see fixtures/roundtrip/README.md) — not a
   * general-purpose escape hatch for new non-idempotency.
   */
  idempotenceExempt: string | null;
  /**
   * Non-default export options for this fixture, if a `<name>.export-options.json`
   * sidecar exists (e.g. `{"wikiLinkPromotion":"off"}`) — parsed directly into
   * the shape `roundTrip()`'s `exportOptions` expects. Absent (`{}`) for every
   * fixture exercising the default configuration.
   */
  exportOptions: ExportOptions;
}

/**
 * Recursively walks `dir` for `*.md` fixture files (excluding `*.expected.md` sidecars
 * and any file named README.md), pairing each with its optional `.expected.md` /
 * `.error.txt` sidecar. Fixture `name` is the path relative to `dir`, without extension,
 * using `/` as the separator regardless of platform.
 */
export function discoverFixtures(dir: string): FixtureEntry[] {
  const entries: FixtureEntry[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      if (entry.name.endsWith('.expected.md')) continue;
      if (entry.name === 'README.md') continue;

      const stem = fullPath.slice(0, -'.md'.length);
      const expectedPath = `${stem}.expected.md`;
      const errorPath = `${stem}.error.txt`;
      const idempotenceExemptPath = `${stem}.idempotence-exempt.txt`;
      const exportOptionsPath = `${stem}.export-options.json`;

      let idempotenceExempt: string | null = null;
      if (existsSync(idempotenceExemptPath)) {
        idempotenceExempt = readFileSync(idempotenceExemptPath, 'utf-8').trim();
        if (idempotenceExempt === '') {
          throw new Error(
            `${idempotenceExemptPath} exists but is empty — it must state a reason (this is not a general escape hatch)`,
          );
        }
      }

      let exportOptions: ExportOptions = {};
      if (existsSync(exportOptionsPath)) {
        try {
          exportOptions = JSON.parse(readFileSync(exportOptionsPath, 'utf-8'));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`${exportOptionsPath} is not valid JSON: ${reason}`, { cause: error });
        }
      }

      const name = relative(dir, stem).split(sep).join('/');
      entries.push({
        name,
        path: fullPath,
        input: readFileSync(fullPath, 'utf-8'),
        expected: existsSync(expectedPath) ? readFileSync(expectedPath, 'utf-8') : null,
        expectedError: existsSync(errorPath) ? readFileSync(errorPath, 'utf-8').trim() : null,
        idempotenceExempt,
        exportOptions,
      });
    }
  }

  walk(dir);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/**
 * Formats a unified diff between expected and actual content for use as a test
 * failure message. Localizes to changed hunks rather than dumping both blobs.
 */
export function formatUnifiedDiff(expected: string, actual: string, label: string): string {
  if (expected === actual) return '';
  const patch = createTwoFilesPatch('expected', 'actual', expected, actual, undefined, undefined, {
    context: 3,
  });
  return `Round-trip mismatch for ${label}:\n\n${patch}`;
}

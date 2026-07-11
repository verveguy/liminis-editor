/**
 * Shared test-support helpers for round-trip (markdown -> Lexical -> markdown) tests.
 *
 * Exercises the real production pipeline: parseMarkdown -> importMarkdownToLexical ->
 * exportLexicalToMdast -> stringifyMarkdown. Used both by footnote-collection.test.ts
 * and by the fixture-driven corpus in fixture-roundtrip.test.ts.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createEditor, LexicalEditor } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { AutoLinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import {
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  CustomLinkNode,
  FootnoteNode,
} from '../../editor/nodes';
import { parseMarkdown } from '../../../markdown/parse';
import { stringifyMarkdown } from '../../../markdown/stringify';
import { importMarkdownToLexical } from '../mdastToLexical';
import { exportLexicalToMdast } from '../lexicalToMdast';
import { createTwoFilesPatch } from 'diff';

// All editor node types, matching Editor.tsx
export const editorNodes = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  CustomLinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  CalloutNode,
  ToggleContainerNode,
  ToggleTitleNode,
  ToggleContentNode,
  ImageNode,
  HorizontalRuleNode,
  EquationNode,
  MermaidNode,
  C4Node,
  FrontmatterNode,
  FootnoteNode,
];

export function createTestEditor(): LexicalEditor {
  return createEditor({
    namespace: 'test',
    nodes: editorNodes,
    onError: (error) => {
      throw error;
    },
  });
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
): Promise<{ mdast: ReturnType<typeof exportLexicalToMdast>; output: string }> {
  return new Promise((resolve, reject) => {
    const editor = createTestEditor();
    const parsed = parseMarkdown(markdown);

    editor.update(
      () => {
        importMarkdownToLexical(editor, parsed.root);
      },
      {
        discrete: true,
        onUpdate: () => {
          try {
            const mdast = exportLexicalToMdast(editor);
            const output = stringifyMarkdown(mdast);
            resolve({ mdast, output });
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
    );
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

      const name = relative(dir, stem).split(sep).join('/');
      entries.push({
        name,
        path: fullPath,
        input: readFileSync(fullPath, 'utf-8'),
        expected: existsSync(expectedPath) ? readFileSync(expectedPath, 'utf-8') : null,
        expectedError: existsSync(errorPath) ? readFileSync(errorPath, 'utf-8').trim() : null,
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

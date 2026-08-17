/**
 * The `./nodes` subpath (#954) is the only declared entry point that
 * legitimately needs Lexical and React — its whole purpose is to export the
 * node classes `importMarkdownToLexical`/`exportLexicalToMdast` instantiate.
 * What it must NOT do is drag in the weight the issue exists to let a
 * consumer avoid: Mermaid's/C4's/Prism's rendering machinery, or the
 * `<App>`/`<Editor>` React UI these node classes are configured into in
 * production. So instead of asserting "no Lexical" (the `./annotations`
 * pattern), this walks the same static graph and asserts on the *specific*
 * heavy packages and UI files a correct extraction must not reach.
 *
 * Two subtleties this walker handles that `annotations-subpath.test.ts`'s
 * simpler graph does not need to:
 *
 * 1. Comments are stripped before scanning for `from '...'` specifiers.
 *    `c4/types.ts` has a doc comment reading `(from "Name" in DSL)`, which the
 *    naive regex would otherwise misread as a bare import of a package named
 *    "Name".
 * 2. Dynamic `import('./Component')` targets are NOT followed as graph edges.
 *    `MermaidNode.tsx`/`C4Node.tsx`/`EquationNode.tsx` lazy-load their
 *    decorator's render component precisely so a non-rendering headless
 *    editor never evaluates Mermaid/dagre or MathJax's browser document —
 *    treating those targets as edges would defeat the whole point of the
 *    lazy boundary and fail this test for weight this subpath doesn't
 *    actually carry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiersOf(source: string): { static: string[]; dynamic: string[] } {
  const clean = stripComments(source);
  return {
    static: [
      ...clean.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...clean.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g),
    ].map((m) => m[1]),
    dynamic: [...clean.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  };
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // try the next extension
    }
  }
  throw new Error(`Unresolvable relative import '${specifier}' from ${fromFile}`);
}

/**
 * Walk the transitive *static* import graph from an entry point. Dynamic
 * `import(...)` targets are collected separately and never followed — they
 * are lazy boundaries by design, not part of what this subpath eagerly loads.
 */
function walkGraph(entry: string): { files: string[]; packages: Set<string>; dynamicTargets: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const dynamicTargets = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const { static: staticSpecifiers, dynamic } = specifiersOf(readFileSync(file, 'utf8'));
    for (const specifier of dynamic) dynamicTargets.add(specifier);
    for (const specifier of staticSpecifiers) {
      const resolved = resolveRelative(file, specifier);
      if (resolved) {
        queue.push(resolved);
      } else {
        packages.add(specifier);
      }
    }
  }

  return { files: [...seen], packages, dynamicTargets: [...dynamicTargets] };
}

describe('./nodes subpath import graph', () => {
  const graph = walkGraph(resolve(SRC, 'nodes.ts'));

  it('pulls in no Mermaid, dagre, Prism, or app-state package — the weight this subpath exists to avoid', () => {
    // Node *class* files (MermaidNode.tsx, C4Node.tsx) legitimately appear in
    // this graph — they're part of the exported node set. It's the heavy
    // rendering packages/files those classes lazily defer to that must be
    // absent; see the dynamic-import test below for the lazy boundary itself.
    const forbidden = [...graph.packages].filter(
      (p) =>
        p === 'mermaid' ||
        p.startsWith('mermaid/') ||
        p === '@dagrejs/dagre' ||
        p === 'prismjs' ||
        p.startsWith('prismjs/') ||
        p === '@lexical/code-prism' ||
        p === 'zustand' ||
        p === 'lucide-react' ||
        p === 'react-dom' ||
        p.startsWith('react-dom/'),
    );
    expect(forbidden).toEqual([]);

    const heavyFiles = graph.files.filter((f) =>
      /MermaidComponent|C4Component|\/mermaid\/|\/dagre\/|prismjs/i.test(f.slice(SRC.length)),
    );
    expect(heavyFiles).toEqual([]);
  });

  it('reaches no App/Editor UI surface other than the mapper-required MarkdownShortcutsPlugin', () => {
    const uiFiles = graph.files
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => /(^|\/)(App|Editor)\.tsx$/.test(rel) || /(^|\/)\w+Plugin\.tsx$/.test(rel))
      .filter((rel) => !rel.endsWith('MarkdownShortcutsPlugin.tsx'));
    expect(uiFiles).toEqual([]);
  });

  it('does not eagerly evaluate the Mermaid/C4/Equation decorator components — only lazily, via dynamic import', () => {
    const lazyTargets = graph.dynamicTargets.filter((t) =>
      ['MermaidComponent', 'C4Component', 'EquationComponent'].some((name) => t.endsWith(name)),
    );
    expect(lazyTargets.sort()).toEqual(['C4Component', 'EquationComponent', 'MermaidComponent'].map((n) => `./${n}`));
  });

  it('permits @mathjax/src as a known, documented exception (carried over from ./headless)', () => {
    const mathjax = [...graph.packages].filter((p) => p.startsWith('@mathjax/'));
    expect(mathjax.length).toBeGreaterThan(0);
  });

  it('depends only on the Lexical/mdast/mapper packages the node set and mapper genuinely need', () => {
    const nonMathjax = [...graph.packages].filter((p) => !p.startsWith('@mathjax/'));
    expect(nonMathjax.sort()).toEqual(
      [
        '@lexical/code',
        '@lexical/link',
        '@lexical/list',
        '@lexical/mark',
        '@lexical/markdown',
        '@lexical/react/LexicalComposerContext',
        '@lexical/rich-text',
        '@lexical/table',
        'lexical',
        'mdast',
        'mdast-util-definition-list',
        'react',
        'zod',
      ].sort(),
    );
  });

  it('is declared as an export subpath in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    // dist/, not src/: since 0.1.1 the checked-in manifest is the published
    // manifest, with no `publishConfig` rewriting at pack time. See ADR-078's
    // 2026-08-16 amendment for why that indirection was reversed.
    expect(pkg.exports['./nodes']).toEqual({
      types: './dist/nodes.d.ts',
      default: './dist/nodes.js',
    });
  });
});

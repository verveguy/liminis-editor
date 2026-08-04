/**
 * The `./annotations` subpath must stay headless (ADR-077, FR-002).
 *
 * The whole reason this is a sixth subpath rather than a re-export from
 * `./headless` or `./markdown` is that it has to be callable outside a rendered
 * editor — from a main process, a worker, or a plain unit test with no DOM. A
 * single stray `import { $getRoot } from 'lexical'` anywhere in its transitive
 * graph would silently destroy that property, and nothing else in the suite
 * would notice. So we walk the graph statically and assert on it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every module specifier in a source file — `from '...'` (import and re-export
 * alike), bare side-effect `import '...'`, and dynamic `import('...')`. All
 * three put a module in the runtime graph, so a scanner that saw only the first
 * would let `import 'lexical'` or `await import('react')` slip past this guard
 * (review finding, CodeRabbit).
 */
function specifiersOf(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // try the next extension
    }
  }
  throw new Error(`Unresolvable relative import '${specifier}' from ${fromFile}`);
}

/** Walk the transitive static-import graph from an entry point. */
function walkGraph(entry: string): { files: string[]; packages: Set<string> } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      const resolved = resolveRelative(file, specifier);
      if (resolved) {
        queue.push(resolved);
      } else {
        packages.add(specifier);
      }
    }
  }

  return { files: [...seen], packages };
}

describe('./annotations subpath import graph', () => {
  const graph = walkGraph(resolve(SRC, 'annotations.ts'));

  it('pulls in no Lexical, React or DOM-bound package', () => {
    const forbidden = [...graph.packages].filter(
      (p) =>
        p === 'lexical' ||
        p.startsWith('@lexical/') ||
        p === 'react' ||
        p === 'react-dom' ||
        p.startsWith('react/') ||
        p.startsWith('react-dom/') ||
        p === 'zustand' ||
        p === 'lucide-react',
    );
    expect(forbidden).toEqual([]);
  });

  it('pulls in no MathJax, Mermaid, C4 or Prism module — the ./headless weight it exists to avoid', () => {
    const heavy = [...graph.packages].filter(
      (p) => p.includes('mathjax') || p.includes('mermaid') || p.includes('prismjs') || p.includes('dagre'),
    );
    expect(heavy).toEqual([]);

    const heavyFiles = graph.files.filter(
      (f) => /mathjax|mermaid|c4|prism/i.test(f.slice(SRC.length)),
    );
    expect(heavyFiles).toEqual([]);
  });

  it('reaches no module outside src/annotations/ — the subpath owns its own graph', () => {
    const outside = graph.files
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => rel !== 'annotations.ts' && !rel.startsWith('annotations/'));
    expect(outside).toEqual([]);
  });

  it('depends only on the pure-parsing packages the anchor modules genuinely need', () => {
    expect([...graph.packages].sort()).toEqual([
      'mdast-util-from-markdown',
      'mdast-util-gfm',
      'micromark-extension-gfm',
      'zod',
    ]);
  });

  it('is declared as an export subpath in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports['./annotations']).toEqual({
      types: './src/annotations.ts',
      default: './src/annotations.ts',
    });
  });
});

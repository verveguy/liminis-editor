/**
 * FR-004 / SC-004: the annotation mechanism is opt-in and off by default.
 *
 * Two independent checks, because either alone is weak:
 *
 * 1. Behavioural — an `<Editor>` with no `annotationKinds` registers no
 *    annotation command and renders no annotation UI.
 * 2. Structural — a static walk of `Editor.tsx`'s *runtime* import graph never
 *    reaches `src/annotations/**` or any annotation plugin. This is the check
 *    that actually holds the line: the behavioural test would still pass if
 *    someone converted the lazy import to a static one, and the whole point of
 *    the lazy boundary is that a consumer with annotations off never pulls
 *    those modules in at all.
 *
 * The package is consumed as TypeScript source, so this is asserted at the
 * import graph rather than as a bundle byte count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = resolve(HERE, '..');
const SRC = resolve(EDITOR_DIR, '..', '..');

/**
 * Runtime `from '...'` specifiers only — `import type` / `export type` lines
 * are erased by the compiler and put nothing in the runtime graph, and
 * `Editor.tsx` deliberately uses them for the annotation prop types.
 */
function runtimeSpecifiersOf(source: string): string[] {
  const specifiers: string[] = [];

  // The clause may span lines, but must not span a `;` or a further
  // import/export keyword. With an unconstrained `[\s\S]*?`, a statement with
  // no `from` (a bare `import './x';`) pairs with the *next* `from` in the
  // file and swallows everything between — dropping that specifier and its
  // whole subtree from the walk. A silent false pass on exactly the property
  // this suite exists to hold (review finding, CodeRabbit).
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+((?:(?!\bimport\b|\bexport\b)[^;'"])*?)from\s+['"]([^'"]+)['"]/g,
  )) {
    const [, clause, specifier] = match;

    // `import type { X } from '...'` — erased wholesale.
    if (/^\s*type\s/.test(clause)) continue;

    // `import { type X, type Y } from '...'` — erased only if *every* named
    // binding is type-qualified. A default or namespace binding outside the
    // braces always means a real runtime edge.
    const named = /^[^{]*\{([\s\S]*)\}/.exec(clause);
    if (named && !/\S/.test(clause.slice(0, clause.indexOf('{')))) {
      const bindings = named[1]
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
      if (bindings.length > 0 && bindings.every((b) => b.startsWith('type '))) continue;
    }

    specifiers.push(specifier);
  }

  // Bare side-effect imports carry no clause and no `from`, so the loop above
  // cannot see them — but they are real runtime edges and must be walked.
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(match[1]);
  }

  // Dynamic `import('...')` is a *runtime* edge but an intentionally deferred
  // one — it is exactly the lazy boundary under test, so it is excluded here
  // and asserted on separately below.
  return specifiers;
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
  return null; // a path we can't resolve is not an annotation module
}

function walkStaticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const specifier of runtimeSpecifiersOf(source)) {
      const resolved = resolveRelative(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }

  return seen;
}

/**
 * What counts as an "annotation module" for FR-004.
 *
 * `annotationCommands.ts` is deliberately excluded: it declares a Lexical
 * command and imports nothing but `lexical`, carrying no anchor, mark or
 * resolver machinery. Keeping it out of the lazy boundary is what lets a
 * statically-imported plugin (the selection context menu) enter the mechanism
 * without dragging any of it into the annotations-disabled graph. It is
 * asserted below to stay that trivial.
 */
const ANNOTATION_MODULE = /(^|\/)(annotations\/|annotations\.ts$|Annotation[A-Za-z]*\.tsx?$|annotation-marks\.ts$)/;

describe('SC-004: annotation modules are unreachable from Editor.tsx by static import', () => {
  const graph = walkStaticGraph(resolve(EDITOR_DIR, 'Editor.tsx'));

  it('walks a non-trivial graph (guards against a vacuous pass)', () => {
    expect(graph.size).toBeGreaterThan(10);
  });

  it('reaches no annotation module', () => {
    const reached = [...graph]
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => ANNOTATION_MODULE.test(rel))
      .sort();

    expect(reached).toEqual([]);
  });

  it('reaches the annotation surface only through a dynamic import', () => {
    const source = readFileSync(resolve(EDITOR_DIR, 'Editor.tsx'), 'utf8');

    // The lazy boundary is present...
    expect(source).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/AnnotationSurface['"]\)\s*\)/);
    // ...and is not shadowed by a static import of the same module.
    expect(source).not.toMatch(/^\s*import\s+[^;]*from\s+['"]\.\/AnnotationSurface['"]/m);
  });

  it('keeps annotationCommands.ts trivial — a command declaration and nothing more', () => {
    const source = readFileSync(resolve(EDITOR_DIR, 'annotationCommands.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['lexical']);
  });

  it('keeps the annotation prop types as type-only imports', () => {
    const source = readFileSync(resolve(EDITOR_DIR, 'Editor.tsx'), 'utf8');
    expect(source).toMatch(/import type \{[\s\S]*?\} from '\.\.\/\.\.\/annotations\/types'/);
    expect(source).toMatch(/import type \{ AnnotationCreateEvent \} from '\.\/AnnotationPlugin'/);
  });
});

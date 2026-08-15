/**
 * `docs/` ships inside the published tarball (`package.json`'s `files` field).
 * A citation to `ADR-0NN` in a shipped document is a promise that
 * `docs/decisions/adr-0NN.md` exists for an adopter to follow it to. Nothing
 * enforced that promise before this suite — see issue #4.
 *
 * `docs/decisions/` itself is excluded: its own README documents, by design,
 * host-application ADR numbers that are cited there but deliberately not
 * imported into this repository.
 *
 * See `docs/provenance.md` for how `ADR-0NN` references are meant to be read
 * in this extracted repository.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'docs');
const DECISIONS_ROOT = resolve(DOCS_ROOT, 'decisions');

/** Three-digit ADR numbers with a matching `docs/decisions/adr-0NN.md` record. */
function validAdrNumbers(): Set<string> {
  const numbers = new Set<string>();
  for (const entry of readdirSync(DECISIONS_ROOT, { encoding: 'utf-8' })) {
    const match = /^adr-(\d{3})\.md$/i.exec(entry);
    if (match) numbers.add(match[1]);
  }
  return numbers;
}

/** `README.md` plus every `.md` file under `docs/**`, excluding `docs/decisions/**`. */
function shippedDocFiles(): string[] {
  const decisionsPrefix = `decisions${sep}`;
  const docFiles = readdirSync(DOCS_ROOT, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => entry.endsWith('.md'))
    .filter((entry) => entry !== 'decisions' && !entry.startsWith(decisionsPrefix))
    .map((entry) => resolve(DOCS_ROOT, entry));

  return [resolve(REPO_ROOT, 'README.md'), ...docFiles];
}

/** All bare `ADR-NNN` citations (case-insensitive) found in a file's text. */
function citationsIn(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  return [...source.matchAll(/\bADR-(\d{3})\b/gi)].map((match) => match[1]);
}

describe('shipped docs do not cite dangling ADRs', () => {
  it('finds shipped docs and valid ADR records to check them against', () => {
    // Anti-vacuity: if either walk returns nothing, the main assertion below
    // would pass trivially without checking anything.
    expect(
      shippedDocFiles().length,
      'found no shipped doc files to scan; the guard would be vacuous',
    ).toBeGreaterThan(0);
    expect(
      validAdrNumbers().size,
      'found no ADR records in docs/decisions/; the guard would be vacuous',
    ).toBeGreaterThan(0);
  });

  it('resolves every ADR-0NN citation outside docs/decisions/ to a real record', () => {
    const valid = validAdrNumbers();
    const offenders: string[] = [];

    for (const file of shippedDocFiles()) {
      for (const number of citationsIn(file)) {
        if (!valid.has(number)) {
          offenders.push(`${relative(REPO_ROOT, file)}: ADR-${number}`);
        }
      }
    }

    expect(
      offenders,
      'a shipped document cites an ADR with no record in docs/decisions/ — an adopter ' +
        'reading the public package would follow this citation nowhere',
    ).toEqual([]);
  });
});

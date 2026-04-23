import { parse, stringify } from 'yaml';

export interface CorrectionEntry {
  type: 'same_as' | 'retract';
  canonical: string;
  aliases: string[];
  applied_at?: string;
}

interface CorrectionsFile {
  corrections: CorrectionEntry[];
}

export function parseCorrectionsYaml(raw: string | null): CorrectionEntry[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = parse(raw) as CorrectionsFile | null;
    if (!Array.isArray(parsed?.corrections)) return [];
    return parsed.corrections.filter(
      (e): e is CorrectionEntry =>
        typeof e === 'object' &&
        e !== null &&
        (e.type === 'same_as' || e.type === 'retract') &&
        typeof e.canonical === 'string' &&
        Array.isArray(e.aliases) &&
        (e.aliases as unknown[]).every((a) => typeof a === 'string') &&
        (e.applied_at === undefined || typeof e.applied_at === 'string')
    );
  } catch {
    return [];
  }
}

export function serializeCorrectionsYaml(entries: CorrectionEntry[]): string {
  const file: CorrectionsFile = { corrections: entries };
  return stringify(file);
}

export function mergeCorrection(
  entries: CorrectionEntry[],
  alias: string,
  canonical: string
): CorrectionEntry[] {
  const result = entries.map((e) => ({ ...e, aliases: [...e.aliases] }));

  // If alias exists in a same_as entry, update that entry's canonical (never touch retract entries)
  const existingIdx = result.findIndex((e) => e.type === 'same_as' && e.aliases.includes(alias));
  if (existingIdx >= 0) {
    result[existingIdx] = { ...result[existingIdx], canonical };
    return result;
  }

  // Otherwise append a new same_as entry
  result.push({ type: 'same_as', canonical, aliases: [alias] });
  return result;
}

export function isExistingCanonical(entries: CorrectionEntry[], text: string): boolean {
  const lower = text.toLowerCase();
  return entries.some((e) => e.type === 'same_as' && e.canonical.toLowerCase() === lower);
}

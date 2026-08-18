/**
 * Hand-written type declarations for `theming-tokens.mjs`, kept plain JS per
 * `scripts/lib/`'s existing convention (see `install-tarball.mjs`) rather than
 * introducing a build step. Consumed by `tests/theming-contract.test.ts`,
 * which is type-checked as part of `tests/**` under `tsconfig.json`.
 */

export interface ConsumptionSite {
  file: string;
  hasFallback: boolean;
}

export interface ConsumedTokenEntry {
  files: Set<string>;
  sites: ConsumptionSite[];
  properties: Set<string>;
}

export type Classification = 'structural' | 'cosmetic';

export interface InventoryRow {
  name: string;
  resolves: boolean;
  hasDefault: boolean;
  classification: Classification;
}

export function stripCssComments(text: string): string;
export function stripJsComments(text: string): string;
export function consumedTokens(srcRoot: string): Map<string, ConsumedTokenEntry>;
export function defaultedTokens(stylesCssPath: string): Set<string>;
export function resolvesWithoutHost(
  name: string,
  consumed: Map<string, ConsumedTokenEntry>,
  defaulted: Set<string>,
): boolean;
export function classify(name: string, properties?: Set<string>): Classification;
export function buildInventory(srcRoot: string, stylesCssPath: string): InventoryRow[];
export function renderTokenTable(inventory: InventoryRow[]): string;
export function parseDocumentedTokens(markdownBlock: string): Set<string>;

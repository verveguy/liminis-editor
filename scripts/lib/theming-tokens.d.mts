/**
 * Hand-written type declarations for `theming-tokens.mjs`, kept plain JS per
 * `scripts/lib/`'s existing convention (see `install-tarball.mjs`) rather than
 * introducing a build step. Consumed by `tests/theming-contract.test.ts`,
 * which is type-checked as part of `tests/**` under `tsconfig.json`.
 */

export interface ConsumptionSite {
  file: string;
  hasFallback: boolean;
  /**
   * The token name immediately nested inside this site's fallback, if its
   * fallback opens with another `var(--y...)` call — null otherwise. For a
   * renamed (#51) token this is the previous-family name the fallback
   * chain preserves; checked against `PREVIOUS_NAME` by the drift guard.
   */
  immediateFallback: string | null;
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
  description: string | undefined;
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
export const PREVIOUS_NAME: Record<string, string>;
export function resolvesToPreviousName(
  name: string,
  consumed: Map<string, ConsumedTokenEntry>,
): boolean;
export function classify(name: string, properties?: Set<string>): Classification;
export function describe(name: string): string | undefined;
export function buildInventory(srcRoot: string, stylesCssPath: string): InventoryRow[];
export function renderTokenTable(inventory: InventoryRow[]): string;
export function parseDocumentedTokens(markdownBlock: string): Set<string>;

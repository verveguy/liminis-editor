/**
 * Hand-written type declarations for `generate-theming-docs.mjs`, kept plain
 * JS per `scripts/`'s existing convention. Consumed by
 * `tests/theming-contract.test.ts` (the README-staleness check).
 */

export function renderThemingBlock(): string;
export function withThemingBlock(readme: string, block: string): string;

/**
 * Hand-written type declarations for `editor-app-prop-forwarding.mjs`, kept
 * plain JS per `scripts/lib/`'s existing convention (see
 * `theming-tokens.d.mts`) rather than introducing a build step. Consumed by
 * `tests/editor-app-forwarding-contract.test.ts`, which is type-checked as
 * part of `tests/**` under `tsconfig.json`.
 */

export function stripComments(text: string): string;
export function extractInterfaceMembers(source: string, interfaceName: string): string[];
export function extractJsxAttributes(source: string, elementName: string): string[];
export const EDITOR_INTERNAL_PROPS: Record<string, string>;

declare module 'micromark-extension-wiki-link' {
  // Minimal typing shim for module without TS types.
  export const syntax: (options?: { aliasDivider?: string }) => unknown;
}

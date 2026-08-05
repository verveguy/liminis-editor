/**
 * TypeScript has nothing to say about a CSS import, so a side-effect import of
 * `@liminis/editor/styles.css` is a type error without a declaration like this
 * one. Every external consumer that type-checks needs the same shim (bundler
 * starter templates ship it as `declare module '*.css'`); it is here so the
 * fixture is honest about what an adopter has to write.
 */
declare module '*.css'

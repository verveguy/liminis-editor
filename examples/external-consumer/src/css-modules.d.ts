/**
 * TypeScript has nothing to say about a CSS import, so a side-effect import of
 * `@liminis/editor/styles.css` is a type error (TS2882) without a declaration
 * like this one. Every external consumer that type-checks needs the same shim
 * (bundler starter templates ship it as `declare module '*.css'`); it is here so
 * the fixture is honest about what an adopter has to write.
 *
 * **This file is why the fixture cannot catch the problem it documents.** By
 * carrying the workaround, it type-checks cleanly whether or not an adopter
 * would — so the friction is invisible to CI and has to be closed by
 * documentation instead. It is: see "TypeScript needs to be told CSS imports
 * exist" in `packages/editor/README.md`. Keep the two in sync; if this shim
 * ever stops being necessary, that section is stale.
 *
 * Deleting this file is a legitimate way to re-measure: `pnpm run
 * typecheck:bundler` from this directory then reports exactly the error a bare
 * adopter sees. (Run it from here, not with `--filter` from the root — this
 * fixture sits outside the `packages/*` workspace glob on purpose, so that it
 * installs the packed tarball rather than a symlink.)
 */
declare module '*.css'

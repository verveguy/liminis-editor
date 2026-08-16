#!/usr/bin/env node
/**
 * Refuse to publish unless the publish was meant.
 *
 * `private: true` in package.json is the documented guard, but it is not one
 * you can verify: `npm publish --dry-run` (npm 10.8.2) runs the whole build,
 * packs every file, reports "Publishing to https://registry.npmjs.org/ with
 * tag latest and public access", and exits 0 — with no mention of the package
 * being private. Whatever the real publish path does, the rehearsal gives no
 * signal, so the first honest confirmation would be an actual publish.
 *
 * npm's unpublish window is 72 hours and narrower than people expect, so an
 * accidental publish of a package that is not ready is close to irreversible.
 * This script makes the intent explicit instead:
 *
 *     LIMINIS_ALLOW_PUBLISH=1 npm publish
 *
 * Runs from `prepublishOnly`, which fires on `npm publish` but not on
 * `npm pack` or `npm install`, so packing the tarball for a consumer — which
 * is how both apps consume this package today — is unaffected.
 */
if (process.env.LIMINIS_ALLOW_PUBLISH !== '1') {
  console.error(`
  Refusing to publish.

  This package is not ready to be published: it is still marked private, the
  repository is private, and publishing is a deliberate, gated step.

  If you mean it:

      LIMINIS_ALLOW_PUBLISH=1 npm publish

  Note that npm's 2FA will prompt for a one-time code, and that publishing
  cannot be undone after 72 hours.
`)
  process.exit(1)
}

console.error('LIMINIS_ALLOW_PUBLISH=1 — publish guard bypassed deliberately.')

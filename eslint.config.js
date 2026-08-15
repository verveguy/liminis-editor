import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

// Originally a port of the host application's config, narrowed to this package
// (verveguy/liminis#995). The React-hooks and no-browser-dialog rule blocks that
// used to be keyed to an `src/editor/**` subtree there apply to all of `src/**`
// here, because all of `src/**` *is* the editor now.
export default tseslint.config(
  // The config files themselves are outside the tsconfig project, so the
  // type-aware parser can't handle them.
  //
  // `dist/**` is ignored for the same reason and it matters more than it looks:
  // the emitted `.d.ts` files are not in any tsconfig project, so a type-aware
  // lint over them fails with a parser error rather than a lint error. The
  // package script only ever passes `src/`, but a bare `eslint .` — a developer
  // exploring, or a future CI step that lints after building — would otherwise
  // hit it. `examples/**` are separate installs with their own toolchains.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'examples/**',
      // Plain Node ESM build tooling, deliberately outside the TypeScript
      // project. The type-aware parser cannot resolve them to a tsconfig, so
      // linting them is a parser error rather than a finding.
      'scripts/**',
      'eslint.config.js',
      'vitest.config.ts',
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        // No `allowDefaultProject` here. `tsconfig.json` already includes
        // `tests/**/*`, and listing a file in both is an error the project
        // service reports as "included by allowDefaultProject but also was
        // found in the project service" — a parser failure, not a lint finding.
        // It stayed latent while the lint script only ever passed `src/`.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // React-specific rules
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Prevent usage of browser dialogs — use a host-supplied dialog/toast instead.
  //
  // `confirm`, `alert` and `prompt` are banned outright rather than discouraged.
  // They synchronously block the host event loop, they cannot be styled or
  // driven from a test, and they simply do not exist in some of the shells this
  // package is embedded in (an Electron renderer with them disabled, a headless
  // environment). A component that reaches for one is unusable in at least one
  // supported host, and fails there in a way no unit test would catch.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'warn',
        {
          name: 'confirm',
          message: 'Use a dialog component instead of confirm(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          name: 'alert',
          message: 'Use the injected host notifyError() instead of alert(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          name: 'prompt',
          message: 'Use a dialog with an input component instead of prompt(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
      ],
      'no-restricted-properties': [
        'warn',
        {
          object: 'window',
          property: 'confirm',
          message: 'Use a dialog component instead of window.confirm(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          object: 'window',
          property: 'alert',
          message: 'Use the injected host notifyError() instead of window.alert(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'Use a dialog with an input component instead of window.prompt(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          object: 'globalThis',
          property: 'confirm',
          message: 'Use a dialog component instead of globalThis.confirm(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          object: 'globalThis',
          property: 'alert',
          message: 'Use the injected host notifyError() instead of globalThis.alert(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
        {
          object: 'globalThis',
          property: 'prompt',
          message: 'Use a dialog with an input component instead of globalThis.prompt(). Native dialogs block the host event loop, cannot be styled or tested, and are not available in every shell this package runs in.',
        },
      ],
      // The package must never reach back into its host. Every host capability
      // arrives by injection, which is what lets this package build, test and
      // ship with no host present at all. The patterns name hosts this package
      // has actually been embedded in; a path match is the cheap way to catch a
      // relative import that has escaped the package boundary.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/liminis-app/**', '**/messaging-electron*'],
              message:
                '@liminis/editor must not import from a host application. Inject the capability via EditorHostServices (src/host/types.ts) instead.',
            },
          ],
        },
      ],
      // The other half of the host-independence rule above.
      // `no-restricted-imports` only covers module paths; the preload API is
      // reached through a global, so it needs a syntax rule. Uses
      // `no-restricted-syntax` rather than another `no-restricted-properties`
      // entry because a second declaration of that rule would replace the
      // browser-dialog entries above wholesale, and because this is an error
      // where those are warnings.
      //
      // Three selectors, because one AST shape does not cover the ways this
      // reach-in can be spelled:
      //
      //  1. Dotted: `window.api`, `window?.api`, `globalThis.api`. ESTree models
      //     `a?.b` as a MemberExpression too, so the optional forms come free.
      //  2. Computed: `window['api']`, `window?.['api']`. Here `property` is a
      //     Literal with a `value`, not an Identifier with a `name`, so selector
      //     (1) does not match it.
      //  3. Cast: `(window as unknown as { api: … }).api` and its computed
      //     spelling. The object is a TSAsExpression rather than an Identifier,
      //     so neither of the above matches. This is the form a regression would
      //     most likely take — plain `window.api` already fails typecheck here,
      //     since the package deliberately carries no declaration for it.
      //
      //     The cast selector must be anchored to the *cast operand*, not just
      //     to the cast: keying only on `object.type='TSAsExpression'` also
      //     reports innocent code like `(someService as unknown as { api: Client }).api`.
      //     Hence the `:matches(...)` on `object.expression` (a direct
      //     `window as X`) and `object.expression.expression` (the doubled
      //     `window as unknown as X`), which is the idiomatic spelling.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name=/^(window|globalThis)$/][property.name='api']",
          message:
            '@liminis/editor must not reach into the host via window.api. Add the capability to EditorHostServices (src/host/types.ts), give it a safe default (src/host/defaults.ts), and implement it in the host adapter. See ADR-075.',
        },
        {
          selector:
            "MemberExpression[object.name=/^(window|globalThis)$/][computed=true][property.value='api']",
          message:
            '@liminis/editor must not reach into the host via window["api"]. Add the capability to EditorHostServices (src/host/types.ts), give it a safe default (src/host/defaults.ts), and implement it in the host adapter. See ADR-075.',
        },
        {
          selector:
            "MemberExpression[object.type='TSAsExpression']" +
            ':matches(' +
            '[object.expression.name=/^(window|globalThis)$/], ' +
            '[object.expression.expression.name=/^(window|globalThis)$/]' +
            ')' +
            ":matches([property.name='api'], [computed=true][property.value='api'])",
          message:
            '@liminis/editor must not reach into the host by casting window to expose `api`. Add the capability to EditorHostServices (src/host/types.ts), give it a safe default (src/host/defaults.ts), and implement it in the host adapter. See ADR-075.',
        },
      ],
    },
  },

  // Project-specific rule overrides (carried over from liminis-app)
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/prefer-function-type': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-types': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/require-await': 'off',
      'no-case-declarations': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  }
)

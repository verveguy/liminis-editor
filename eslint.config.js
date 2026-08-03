import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

// Port of liminis-app/eslint.config.js, narrowed to the editor package.
// The React-hooks and ADR-024 no-browser-dialog rule blocks that used to be
// keyed to `src/editor/**` in liminis-app apply to all of `src/**` here.
export default tseslint.config(
  { ignores: ['node_modules/**', 'coverage/**'] },

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
        projectService: {
          allowDefaultProject: ['tests/*.ts'],
        },
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

  // Prevent usage of browser dialogs - use a host-supplied dialog/toast instead (ADR-024)
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'warn',
        {
          name: 'confirm',
          message: 'Use a dialog component instead of confirm(). See ADR-024.',
        },
        {
          name: 'alert',
          message: 'Use the injected host notifyError() instead of alert(). See ADR-024.',
        },
        {
          name: 'prompt',
          message: 'Use a dialog with an input component instead of prompt(). See ADR-024.',
        },
      ],
      'no-restricted-properties': [
        'warn',
        {
          object: 'window',
          property: 'confirm',
          message: 'Use a dialog component instead of window.confirm(). See ADR-024.',
        },
        {
          object: 'window',
          property: 'alert',
          message: 'Use the injected host notifyError() instead of window.alert(). See ADR-024.',
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'Use a dialog with an input component instead of window.prompt(). See ADR-024.',
        },
        {
          object: 'globalThis',
          property: 'confirm',
          message: 'Use a dialog component instead of globalThis.confirm(). See ADR-024.',
        },
        {
          object: 'globalThis',
          property: 'alert',
          message: 'Use the injected host notifyError() instead of globalThis.alert(). See ADR-024.',
        },
        {
          object: 'globalThis',
          property: 'prompt',
          message: 'Use a dialog with an input component instead of globalThis.prompt(). See ADR-024.',
        },
      ],
      // FR-008 / SC-004: the package must never reach back into its host.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/liminis-app/**', '**/messaging-electron*'],
              message:
                '@liminis/editor must not import from liminis-app. Inject the capability via EditorHostServices instead.',
            },
          ],
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

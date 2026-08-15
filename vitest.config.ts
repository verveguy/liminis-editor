import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    // `tests/` holds suites about the package as a shipped artifact — its
    // manifest, its publish guard — rather than about a module under `src/`.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    // A hung test must never block the whole suite (or a Fabrik stage).
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/node_modules/**', '**/*.d.ts', '**/*.config.*', '**/__tests__/**'],
    },
    setupFiles: ['./tests/setup.ts'],
  },
})

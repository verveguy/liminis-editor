import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Builds one measurement arm, selected by the `ARM` environment variable.
 *
 * Alongside the bundle, a `modules.json` is written recording — per emitted
 * chunk — which source modules went into it and which chunks it imports
 * statically vs. dynamically. `scripts/verify-package.mjs` reads that to assert
 * the entry-graph boundaries the six subpaths exist to keep. Grepping the
 * emitted JS for identifier substrings would not do: minified output loses the
 * names, and a chunk containing the string `annotation` says nothing about
 * whether it is *loaded*.
 */
const ARM = process.env.ARM
if (!ARM) throw new Error('ARM env var is required (markdown-only | annotations-off | annotations-on)')

const ENTRIES = {
  'markdown-only': 'src/arms/markdown-only.ts',
  'annotations-off': 'src/arms/annotations-off.tsx',
  'annotations-on': 'src/arms/annotations-on.tsx',
}

const entry = ENTRIES[ARM]
if (!entry) throw new Error(`unknown ARM: ${ARM}`)

const outDir = `dist/${ARM}`

function recordModules() {
  return {
    name: 'record-modules',
    generateBundle(_options, bundle) {
      const chunks = {}
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        chunks[fileName] = {
          isEntry: Boolean(output.isEntry),
          modules: Object.keys(output.modules ?? {}),
          imports: output.imports ?? [],
          dynamicImports: output.dynamicImports ?? [],
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'modules.json',
        source: JSON.stringify({ arm: ARM, chunks }, null, 2),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), recordModules()],
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    // Unminified: `modules.json` is the measurement, and readable output makes
    // a failed assertion something a human can go and look at.
    minify: false,
    rollupOptions: {
      input: resolve(process.cwd(), entry),
      output: { entryFileNames: 'entry.js' },
    },
  },
})

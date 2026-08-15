import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base: './'` — the built renderer is loaded from disk via `win.loadFile()`,
// not served over http://, so asset URLs must resolve relative to
// `dist/renderer/index.html` rather than from the site root.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5178, open: true },
  // GitHub Pages serves a user-owned repo's site from a subpath
  // (`/liminis-editor/`). The Pages workflow supplies it via
  // `actions/configure-pages@v4`'s `base_path` output; local dev/builds
  // default to the site root.
  base: process.env.VITE_BASE_PATH || '/',
})

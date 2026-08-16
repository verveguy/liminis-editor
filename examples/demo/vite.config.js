import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a user-owned repo's site from a subpath
// (`/liminis-editor`, no trailing slash). The Pages workflow supplies it via
// `actions/configure-pages@v4`'s `base_path` output, but Vite's `base` must
// end with `/` for correct asset URL resolution — without normalizing,
// `/liminis-editor` (no trailing slash) would produce broken asset paths.
// Local dev/builds default to the site root.
function normalizeBasePath(basePath) {
  if (!basePath) return '/'
  return basePath.endsWith('/') ? basePath : `${basePath}/`
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5178, open: true },
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
})

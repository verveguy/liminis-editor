/**
 * Minimal Electron main process for the `@liminis/editor` e2e shell
 * (verveguy/liminis-editor#2, FR-001).
 *
 * Deliberately small: one `BrowserWindow` loading the built renderer, no
 * preload script, no IPC, no menu customization. `@liminis/editor` is never
 * imported here — nothing in this process needs it, and if that ever
 * changes, the root entry (which assumes a DOM) is the wrong one to reach
 * for from the main process; `@liminis/editor/headless` is the one built for
 * this environment (see `src/index.ts`'s own header comment).
 *
 * `EditorHostServices` is left entirely unsupplied on the renderer side —
 * the package's built-in no-op defaults (`resolveHostServices`) already are
 * the "stubbed host services" FR-001 asks for. There is nothing for this
 * process to stub.
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

// The read-only e2e scenario (verveguy/liminis#965's shape) is selected by
// launching with `--readonly` rather than by a second renderer entry point —
// one minimal shell, one query param, both FR-004 scenarios.
const READONLY = process.argv.includes('--readonly')

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'), {
    search: READONLY ? 'readonly=1' : '',
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

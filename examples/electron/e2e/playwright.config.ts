import { defineConfig } from '@playwright/test'

// A minimal Electron-launch config — no `webServer`, no browser project: the
// app under test is launched directly by each spec via `_electron.launch()`,
// which manages the CDP connection itself (FR-002).
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  // Electron/CDP launches are slower and less deterministic than a plain
  // browser context — one retry in CI absorbs a flaky first launch without
  // masking a genuinely broken affordance (which fails every retry).
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
})

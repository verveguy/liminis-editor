import { afterAll, vi } from 'vitest'

// happy-dom doesn't set document.compatMode, which causes MathJax/KaTeX to warn
// about quirks mode. Set it to standards mode to suppress the warning.
// Skip this for Node environment tests where document doesn't exist.
if (typeof document !== 'undefined') {
  Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat' })
}

// NOTE: deliberately no host-global mock here. The package reaches its host
// only through injected EditorHostServices (FR-003/FR-008), so a test that
// needs host behaviour supplies a stub service rather than patching a global.

afterAll(() => {
  vi.clearAllMocks()
})

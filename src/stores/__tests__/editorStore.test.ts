import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../editorStore'

describe('editorStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useEditorStore.setState({
      hasFrontmatter: false,
      isFrontmatterOpen: false,
    })
  })

  describe('initial state', () => {
    it('should start with hasFrontmatter false', () => {
      const state = useEditorStore.getState()
      expect(state.hasFrontmatter).toBe(false)
    })

    it('should start with isFrontmatterOpen false', () => {
      const state = useEditorStore.getState()
      expect(state.isFrontmatterOpen).toBe(false)
    })
  })

  describe('setHasFrontmatter', () => {
    it('should set hasFrontmatter to true', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      expect(useEditorStore.getState().hasFrontmatter).toBe(true)
    })

    it('should set hasFrontmatter to false', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().setHasFrontmatter(false)
      expect(useEditorStore.getState().hasFrontmatter).toBe(false)
    })

    it('should close frontmatter tray when hasFrontmatter becomes false', () => {
      // Open the tray first
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().setFrontmatterOpen(true)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)

      // Now set hasFrontmatter to false - tray should close
      useEditorStore.getState().setHasFrontmatter(false)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })

    it('should not affect tray state when hasFrontmatter becomes true', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })
  })

  describe('setFrontmatterOpen', () => {
    it('should set isFrontmatterOpen to true', () => {
      useEditorStore.getState().setFrontmatterOpen(true)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)
    })

    it('should set isFrontmatterOpen to false', () => {
      useEditorStore.getState().setFrontmatterOpen(true)
      useEditorStore.getState().setFrontmatterOpen(false)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })
  })

  describe('toggleFrontmatter', () => {
    it('should not toggle when hasFrontmatter is false', () => {
      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })

    it('should toggle open when hasFrontmatter is true and tray is closed', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)
    })

    it('should toggle closed when hasFrontmatter is true and tray is open', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().setFrontmatterOpen(true)
      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })

    it('should toggle back and forth', () => {
      useEditorStore.getState().setHasFrontmatter(true)

      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)

      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)

      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset hasFrontmatter to false', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().reset()
      expect(useEditorStore.getState().hasFrontmatter).toBe(false)
    })

    it('should reset isFrontmatterOpen to false', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().setFrontmatterOpen(true)
      useEditorStore.getState().reset()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })

    it('should reset all state to initial values', () => {
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().setFrontmatterOpen(true)
      useEditorStore.getState().reset()

      const state = useEditorStore.getState()
      expect(state.hasFrontmatter).toBe(false)
      expect(state.isFrontmatterOpen).toBe(false)
    })
  })

  describe('document switching workflow', () => {
    it('should handle document with frontmatter being opened', () => {
      // User opens document with frontmatter
      useEditorStore.getState().setHasFrontmatter(true)

      // User clicks to open frontmatter tray
      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)

      // User switches to another document (reset is called)
      useEditorStore.getState().reset()

      // New document is loaded with no frontmatter
      useEditorStore.getState().setHasFrontmatter(false)

      expect(useEditorStore.getState().hasFrontmatter).toBe(false)
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
    })

    it('should handle switching between documents with and without frontmatter', () => {
      // Document A with frontmatter
      useEditorStore.getState().setHasFrontmatter(true)
      useEditorStore.getState().toggleFrontmatter() // Open tray

      // Switch to Document B
      useEditorStore.getState().reset()
      useEditorStore.getState().setHasFrontmatter(false)

      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)

      // Switch to Document C with frontmatter
      useEditorStore.getState().reset()
      useEditorStore.getState().setHasFrontmatter(true)

      // Tray should still be closed after reset
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(false)
      // But can be opened
      useEditorStore.getState().toggleFrontmatter()
      expect(useEditorStore.getState().isFrontmatterOpen).toBe(true)
    })
  })
})

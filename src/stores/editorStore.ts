import { create } from 'zustand'

interface EditorState {
  /** Whether the current document has frontmatter */
  hasFrontmatter: boolean
  /** Whether the frontmatter tray is open */
  isFrontmatterOpen: boolean
  
  /** Set frontmatter presence (called by editor plugin) */
  setHasFrontmatter: (has: boolean) => void
  
  /** Set frontmatter tray state (called by editor plugin) */
  setFrontmatterOpen: (isOpen: boolean) => void
  
  /** Toggle frontmatter tray (called by UI button) */
  toggleFrontmatter: () => void
  
  /** Reset editor state (when switching documents) */
  reset: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  hasFrontmatter: false,
  isFrontmatterOpen: false,
  
  setHasFrontmatter: (has: boolean) => {
    set({ hasFrontmatter: has })
    // If no frontmatter, close the tray
    if (!has) {
      set({ isFrontmatterOpen: false })
    }
  },
  
  setFrontmatterOpen: (isOpen: boolean) => {
    set({ isFrontmatterOpen: isOpen })
  },
  
  toggleFrontmatter: () => {
    const state = get()
    if (state.hasFrontmatter) {
      set({ isFrontmatterOpen: !state.isFrontmatterOpen })
    }
  },
  
  reset: () => {
    set({
      hasFrontmatter: false,
      isFrontmatterOpen: false
    })
  }
}))

import { create } from 'zustand'

interface CorrectionState {
  isOpen: boolean
  position: { x: number; y: number }
  selectedText: string

  open: (position: { x: number; y: number }, selectedText: string) => void
  close: () => void
}

export const useCorrectionStore = create<CorrectionState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  selectedText: '',

  open: (position: { x: number; y: number }, selectedText: string) => {
    set({ isOpen: true, position, selectedText })
  },

  close: () => {
    set({ isOpen: false })
  },
}))

/**
 * File type detection utilities for determining how to render files in the editor.
 */

export type FileType = 'markdown' | 'image' | 'pdf' | 'mermaid' | 'code' | 'remarkable-document' | 'unknown'

/**
 * Determine the file type based on path and extension.
 * @param path - The file path to check
 * @returns The detected file type
 */
export function getFileType(path: string | null): FileType {
  if (!path) return 'unknown'

  const ext = path.toLowerCase().split('.').pop() || ''

  // Check for remarkable document - files inside a remarkable document folder
  // Structure: remarkable/DocName/document.pdf, remarkable/DocName/pages/page_001.png, etc.
  // But NOT remarkable/index.md (which is the section index markdown)
  if (path.startsWith('remarkable/')) {
    const parts = path.split('/')
    // parts[0] = 'remarkable', parts[1] = DocName or filename
    // If parts.length >= 3, it's inside a document folder (e.g., remarkable/DocName/document.pdf)
    // If parts.length === 2 and NOT a markdown file, treat as remarkable document folder
    if (parts.length >= 3) {
      return 'remarkable-document'
    }
    // parts.length === 2: remarkable/something - check if it's the index.md or a doc folder reference
    if (parts.length === 2 && !['md', 'mdc'].includes(ext)) {
      return 'remarkable-document'
    }
    // Fall through to normal extension checking for remarkable/index.md
  }

  if (['md', 'mdc'].includes(ext)) return 'markdown'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'mmd') return 'mermaid'
  // Text and data files - use code type for syntax highlighting (aligned with EditorColumn)
  if (['txt', 'log', 'csv', 'json', 'xml', 'yml', 'yaml'].includes(ext)) return 'code'
  // Code file extensions
  const codeExtensions = ['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'go', 'rb', 'php', 'sh', 'bash', 'mjs', 'mts', 'zsh']
  if (codeExtensions.includes(ext)) return 'code'

  return 'unknown'
}

/**
 * React context carrying the injected host services.
 *
 * Context rather than prop drilling: five separate mount sites in liminis-app
 * plus ~20 deeply nested plugins would otherwise have to thread a services
 * object through `App` → `Editor` → every plugin (see ADR-075).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { resolveHostServices } from './defaults'
import type { EditorHostServices, ResolvedEditorHostServices } from './types'

const EditorHostContext = createContext<ResolvedEditorHostServices | null>(null)

export interface EditorHostProviderProps {
  /** Host services. Any omitted member falls back to a safe default. */
  services?: EditorHostServices
  children: ReactNode
}

export function EditorHostProvider({ services, children }: EditorHostProviderProps) {
  const resolved = useMemo(() => resolveHostServices(services), [services])
  return <EditorHostContext.Provider value={resolved}>{children}</EditorHostContext.Provider>
}

/**
 * Access the host services. Usable without a provider — an absent provider
 * yields the same all-defaults object a provider with no services would.
 */
export function useEditorHost(): ResolvedEditorHostServices {
  const value = useContext(EditorHostContext)
  return value ?? FALLBACK_SERVICES
}

const FALLBACK_SERVICES = resolveHostServices(undefined)

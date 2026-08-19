"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type DesignWorkbenchView = "home" | "design" | "prototype" | "run"
export type DesignWorkspacePanel =
  | "layers"
  | "assets"
  | "components"
  | "variables"

interface DesignWorkspaceContextValue {
  artifactId: string | null
  view: DesignWorkbenchView
  query: string
  panel: DesignWorkspacePanel
  setArtifactId: (id: string | null) => void
  setView: (view: DesignWorkbenchView) => void
  setQuery: (query: string) => void
  setPanel: (panel: DesignWorkspacePanel) => void
  openHome: () => void
}

const DesignWorkspaceContext =
  createContext<DesignWorkspaceContextValue | null>(null)

export function useDesignWorkspace() {
  const context = useContext(DesignWorkspaceContext)
  if (!context) {
    throw new Error(
      "useDesignWorkspace must be used within DesignWorkspaceProvider"
    )
  }
  return context
}

export function DesignWorkspaceProvider({ children }: { children: ReactNode }) {
  const [artifactId, setArtifactId] = useState<string | null>(null)
  const [view, setView] = useState<DesignWorkbenchView>("home")
  const [query, setQuery] = useState("")
  const [panel, setPanel] = useState<DesignWorkspacePanel>("layers")

  const openHome = useCallback(() => {
    setArtifactId(null)
    setView("home")
  }, [])

  const value = useMemo<DesignWorkspaceContextValue>(
    () => ({
      artifactId,
      view,
      query,
      panel,
      setArtifactId,
      setView,
      setQuery,
      setPanel,
      openHome,
    }),
    [artifactId, view, query, panel, openHome]
  )

  return (
    <DesignWorkspaceContext.Provider value={value}>
      {children}
    </DesignWorkspaceContext.Provider>
  )
}

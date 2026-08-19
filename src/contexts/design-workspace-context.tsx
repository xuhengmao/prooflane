"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react"
import {
  DEFAULT_WORKSPACE_SESSION,
  clampWorkspaceZoom,
  parseWorkspaceSession,
  serializeWorkspaceSession,
  WORKSPACE_SESSION_STORAGE_KEY,
  type WorkspaceSession,
} from "@/lib/design/workspace-session"

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
  leftCollapsed: boolean
  rightCollapsed: boolean
  zoom: number
  panX: number
  panY: number
  setArtifactId: (id: string | null) => void
  setView: (view: DesignWorkbenchView) => void
  setQuery: (query: string) => void
  setPanel: (panel: DesignWorkspacePanel) => void
  setLeftCollapsed: (collapsed: boolean) => void
  setRightCollapsed: (collapsed: boolean) => void
  setZoom: (zoom: number) => void
  setPan: (panX: number, panY: number) => void
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
  const [session, setSession] = useState<WorkspaceSession>(() => {
    if (typeof window === "undefined") return DEFAULT_WORKSPACE_SESSION
    return parseWorkspaceSession(
      window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY)
    )
  })
  const {
    artifactId,
    view,
    panel,
    leftCollapsed,
    rightCollapsed,
    zoom,
    panX,
    panY,
  } = session
  const [query, setQuery] = useState("")

  const setArtifactId = useCallback(
    (id: string | null) =>
      setSession((current) => ({ ...current, artifactId: id })),
    []
  )
  const setView = useCallback(
    (next: DesignWorkbenchView) =>
      setSession((current) => ({ ...current, view: next })),
    []
  )
  const setPanel = useCallback(
    (next: DesignWorkspacePanel) =>
      setSession((current) => ({ ...current, panel: next })),
    []
  )
  const setLeftCollapsed = useCallback(
    (collapsed: boolean) =>
      setSession((current) => ({ ...current, leftCollapsed: collapsed })),
    []
  )
  const setRightCollapsed = useCallback(
    (collapsed: boolean) =>
      setSession((current) => ({ ...current, rightCollapsed: collapsed })),
    []
  )
  const setZoom = useCallback(
    (next: number) =>
      setSession((current) => ({
        ...current,
        zoom: clampWorkspaceZoom(next),
      })),
    []
  )
  const setPan = useCallback(
    (nextPanX: number, nextPanY: number) =>
      setSession((current) => ({ ...current, panX: nextPanX, panY: nextPanY })),
    []
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(
      WORKSPACE_SESSION_STORAGE_KEY,
      serializeWorkspaceSession(session)
    )
  }, [session])

  const openHome = useCallback(() => {
    setSession((current) => ({ ...current, artifactId: null, view: "home" }))
  }, [])

  const value = useMemo<DesignWorkspaceContextValue>(
    () => ({
      artifactId,
      view,
      query,
      panel,
      leftCollapsed,
      rightCollapsed,
      zoom,
      panX,
      panY,
      setArtifactId,
      setView,
      setQuery,
      setPanel,
      setLeftCollapsed,
      setRightCollapsed,
      setZoom,
      setPan,
      openHome,
    }),
    [
      artifactId,
      view,
      query,
      panel,
      leftCollapsed,
      rightCollapsed,
      zoom,
      panX,
      panY,
      setArtifactId,
      setView,
      setPanel,
      setLeftCollapsed,
      setRightCollapsed,
      setZoom,
      setPan,
      openHome,
    ]
  )

  return (
    <DesignWorkspaceContext.Provider value={value}>
      {children}
    </DesignWorkspaceContext.Provider>
  )
}

export function clearDesignWorkspaceSession() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(WORKSPACE_SESSION_STORAGE_KEY)
  }
}

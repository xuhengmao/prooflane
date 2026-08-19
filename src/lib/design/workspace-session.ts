import type {
  DesignWorkbenchView,
  DesignWorkspacePanel,
} from "@/contexts/design-workspace-context"

export const WORKSPACE_SESSION_STORAGE_KEY = "prooflane.design.workspace.v1"
export const WORKSPACE_SESSION_VERSION = 1 as const
export const MIN_WORKSPACE_ZOOM = 0.1
export const MAX_WORKSPACE_ZOOM = 8

export interface WorkspaceSession {
  version: typeof WORKSPACE_SESSION_VERSION
  artifactId: string | null
  view: DesignWorkbenchView
  panel: DesignWorkspacePanel
  leftCollapsed: boolean
  rightCollapsed: boolean
  zoom: number
  panX: number
  panY: number
}

export const DEFAULT_WORKSPACE_SESSION: WorkspaceSession = {
  version: WORKSPACE_SESSION_VERSION,
  artifactId: null,
  view: "home",
  panel: "layers",
  leftCollapsed: false,
  rightCollapsed: false,
  zoom: 1,
  panX: 0,
  panY: 0,
}

const VIEWS = new Set<DesignWorkbenchView>([
  "home",
  "design",
  "prototype",
  "run",
])
const PANELS = new Set<DesignWorkspacePanel>([
  "layers",
  "assets",
  "components",
  "variables",
])

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function clampWorkspaceZoom(value: number): number {
  return Math.min(MAX_WORKSPACE_ZOOM, Math.max(MIN_WORKSPACE_ZOOM, value))
}

export function parseWorkspaceSession(raw: string | null): WorkspaceSession {
  if (!raw) return DEFAULT_WORKSPACE_SESSION
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object") return DEFAULT_WORKSPACE_SESSION
    const input = value as Record<string, unknown>
    if (input.version !== WORKSPACE_SESSION_VERSION) {
      return DEFAULT_WORKSPACE_SESSION
    }
    return {
      version: WORKSPACE_SESSION_VERSION,
      artifactId:
        typeof input.artifactId === "string" ? input.artifactId : null,
      view: VIEWS.has(input.view as DesignWorkbenchView)
        ? (input.view as DesignWorkbenchView)
        : "home",
      panel: PANELS.has(input.panel as DesignWorkspacePanel)
        ? (input.panel as DesignWorkspacePanel)
        : "layers",
      leftCollapsed: input.leftCollapsed === true,
      rightCollapsed: input.rightCollapsed === true,
      zoom: clampWorkspaceZoom(finiteNumber(input.zoom, 1)),
      panX: finiteNumber(input.panX, 0),
      panY: finiteNumber(input.panY, 0),
    }
  } catch {
    return DEFAULT_WORKSPACE_SESSION
  }
}

export function serializeWorkspaceSession(session: WorkspaceSession): string {
  return JSON.stringify({
    version: WORKSPACE_SESSION_VERSION,
    artifactId: session.artifactId,
    view: session.view,
    panel: session.panel,
    leftCollapsed: session.leftCollapsed,
    rightCollapsed: session.rightCollapsed,
    zoom: clampWorkspaceZoom(finiteNumber(session.zoom, 1)),
    panX: finiteNumber(session.panX, 0),
    panY: finiteNumber(session.panY, 0),
  })
}

import { describe, expect, it } from "vitest"

import {
  DEFAULT_WORKSPACE_SESSION,
  MAX_WORKSPACE_ZOOM,
  MIN_WORKSPACE_ZOOM,
  parseWorkspaceSession,
  serializeWorkspaceSession,
} from "./workspace-session"

describe("workspace session storage", () => {
  it("falls back to defaults for malformed or incompatible JSON", () => {
    expect(parseWorkspaceSession("{not json")).toEqual(
      DEFAULT_WORKSPACE_SESSION
    )
    expect(
      parseWorkspaceSession(
        JSON.stringify({
          version: 2,
          artifactId: "old",
          document: { secret: true },
        })
      )
    ).toEqual(DEFAULT_WORKSPACE_SESSION)
  })

  it("clamps zoom and persists only UI state, never document content", () => {
    const serialized = serializeWorkspaceSession({
      version: 1,
      artifactId: "artifact-1",
      view: "prototype",
      panel: "assets",
      leftCollapsed: true,
      rightCollapsed: false,
      zoom: 999,
      panX: 12,
      panY: -8,
      document: { secret: "must not persist" },
    } as never)

    const stored = JSON.parse(serialized)
    expect(stored).not.toHaveProperty("document")
    expect(stored.zoom).toBe(MAX_WORKSPACE_ZOOM)
    expect(parseWorkspaceSession(serialized)).toMatchObject({
      artifactId: "artifact-1",
      view: "prototype",
      panel: "assets",
      zoom: MAX_WORKSPACE_ZOOM,
      panX: 12,
      panY: -8,
    })
  })

  it("normalizes invalid numeric state to the safe zoom range", () => {
    const session = parseWorkspaceSession(
      JSON.stringify({
        version: 1,
        artifactId: "artifact-1",
        view: "design",
        panel: "layers",
        leftCollapsed: false,
        rightCollapsed: false,
        zoom: -1,
        panX: "bad",
        panY: null,
      })
    )

    expect(session.zoom).toBe(MIN_WORKSPACE_ZOOM)
    expect(session.panX).toBe(0)
    expect(session.panY).toBe(0)
  })
})

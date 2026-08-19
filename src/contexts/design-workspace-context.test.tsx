import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import {
  DesignWorkspaceProvider,
  useDesignWorkspace,
} from "./design-workspace-context"
import { WORKSPACE_SESSION_STORAGE_KEY } from "@/lib/design/workspace-session"

function Probe() {
  const state = useDesignWorkspace()
  return (
    <div>
      <span data-testid="artifact">{state.artifactId ?? "home"}</span>
      <span data-testid="view">{state.view}</span>
      <span data-testid="panel">{state.panel}</span>
      <span data-testid="zoom">{state.zoom}</span>
      <button onClick={() => state.setArtifactId("artifact-1")}>open</button>
      <button onClick={() => state.setView("prototype")}>prototype</button>
      <button onClick={() => state.setPanel("assets")}>assets</button>
      <button onClick={() => state.setZoom(2)}>zoom</button>
      <button onClick={state.openHome}>home</button>
    </div>
  )
}

describe("DesignWorkspaceProvider", () => {
  beforeEach(() => localStorage.clear())

  it("keeps the current artifact and view until the user returns home", () => {
    const view = render(
      <DesignWorkspaceProvider>
        <Probe />
      </DesignWorkspaceProvider>
    )

    fireEvent.click(screen.getByText("open"))
    fireEvent.click(screen.getByText("prototype"))
    fireEvent.click(screen.getByText("assets"))
    view.rerender(
      <DesignWorkspaceProvider>
        <Probe />
      </DesignWorkspaceProvider>
    )

    expect(screen.getByTestId("artifact").textContent).toBe("artifact-1")
    expect(screen.getByTestId("view").textContent).toBe("prototype")
    expect(screen.getByTestId("panel").textContent).toBe("assets")

    fireEvent.click(screen.getByText("home"))
    expect(screen.getByTestId("artifact").textContent).toBe("home")
    expect(screen.getByTestId("view").textContent).toBe("home")
  })

  it("rejects use outside its provider", () => {
    expect(() => render(<Probe />)).toThrow(/DesignWorkspaceProvider/)
  })

  it("restores and persists only the versioned workspace UI session", () => {
    localStorage.setItem(
      WORKSPACE_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        artifactId: "artifact-restored",
        view: "prototype",
        panel: "assets",
        leftCollapsed: true,
        rightCollapsed: false,
        zoom: 2,
        panX: 10,
        panY: -4,
        document: { private: true },
      })
    )

    render(
      <DesignWorkspaceProvider>
        <Probe />
      </DesignWorkspaceProvider>
    )

    expect(screen.getByTestId("artifact").textContent).toBe("artifact-restored")
    expect(screen.getByTestId("view").textContent).toBe("prototype")
    expect(screen.getByTestId("zoom").textContent).toBe("2")

    fireEvent.click(screen.getByText("home"))
    const stored = JSON.parse(
      localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY) ?? "{}"
    )
    expect(stored.artifactId).toBeNull()
    expect(stored).not.toHaveProperty("document")
  })
})

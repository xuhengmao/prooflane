import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  DesignWorkspaceProvider,
  useDesignWorkspace,
} from "./design-workspace-context"

function Probe() {
  const state = useDesignWorkspace()
  return (
    <div>
      <span data-testid="artifact">{state.artifactId ?? "home"}</span>
      <span data-testid="view">{state.view}</span>
      <span data-testid="panel">{state.panel}</span>
      <button onClick={() => state.setArtifactId("artifact-1")}>open</button>
      <button onClick={() => state.setView("prototype")}>prototype</button>
      <button onClick={() => state.setPanel("assets")}>assets</button>
      <button onClick={state.openHome}>home</button>
    </div>
  )
}

describe("DesignWorkspaceProvider", () => {
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
})

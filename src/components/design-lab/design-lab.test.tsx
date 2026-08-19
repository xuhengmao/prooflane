import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DesignLab } from "./design-lab"

describe("DesignLab", () => {
  it("renders the DOM/SVG fixture and exposes renderer controls", async () => {
    render(<DesignLab />)
    expect(
      screen.getByRole("heading", { name: "Prooflane Design Lab" })
    ).toBeTruthy()
    expect(screen.getByTestId("design-lab-canvas")).toBeTruthy()
    expect(await screen.findByText("渲染完成")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("渲染器"), {
      target: { value: "canvaskit" },
    })
    expect(
      (await screen.findAllByText(/CanvasKit WASM/)).length
    ).toBeGreaterThan(0)
  })

  it("previews a deterministic ChangeSet without applying it", async () => {
    render(<DesignLab />)
    fireEvent.click(screen.getByRole("button", { name: "Validate ChangeSet" }))
    expect(await screen.findByTestId("design-lab-ai-status")).toHaveTextContent(
      "等待用户确认"
    )
  })

  it("loads the requested benchmark fixture and renderer", async () => {
    window.history.pushState(
      {},
      "",
      "/__design-lab?fixture=nodes-1000&renderer=dom-svg"
    )
    render(<DesignLab />)
    expect(await screen.findByTestId("design-lab-canvas")).toBeInTheDocument()
    await waitFor(() => {
      expect(
        document.querySelector("main")?.getAttribute("data-fixture-id")
      ).toBe("nodes-1000")
      expect(
        document.querySelector("main")?.getAttribute("data-renderer-id")
      ).toBe("dom-svg")
    })
    window.history.pushState({}, "", "/")
  })
})

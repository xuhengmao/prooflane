import { fireEvent, render, screen } from "@testing-library/react"
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
})

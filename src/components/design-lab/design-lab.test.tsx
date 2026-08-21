import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CanvasKitRuntime } from "@/lib/design/renderers/canvaskit-runtime"
import { DesignLab } from "./design-lab"

function createCanvasKitRuntime(): CanvasKitRuntime {
  const canvas = {
    clear: vi.fn(),
    scale: vi.fn(),
    drawRect: vi.fn(),
    drawText: vi.fn(),
  }
  class Paint {
    delete = vi.fn()
    setAntiAlias = vi.fn()
    setColor = vi.fn()
    setAlphaf = vi.fn()
    setStyle = vi.fn()
    setStrokeWidth = vi.fn()
  }
  class Font {
    delete = vi.fn()
  }
  return {
    MakeCanvasSurface: () => ({
      getCanvas: () => canvas,
      flush: vi.fn(),
      delete: vi.fn(),
    }),
    Paint,
    Font,
    PaintStyle: { Fill: { value: 0 }, Stroke: { value: 1 } },
    Color: vi.fn(() => [1, 1, 1, 1]),
    parseColorString: vi.fn(() => [0, 0, 0, 1]),
    XYWHRect: vi.fn((x, y, width, height) => [x, y, x + width, y + height]),
  } as unknown as CanvasKitRuntime
}

describe("DesignLab", () => {
  it("renders the DOM/SVG fixture and exposes renderer controls", async () => {
    render(
      <DesignLab
        loadCanvasKit={async () => {
          throw new Error("CanvasKit WASM test unavailable")
        }}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Prooflane Design Lab" })
    ).toBeTruthy()
    expect(screen.getByTestId("design-lab-canvas")).toBeTruthy()
    expect(await screen.findByText("渲染完成")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("渲染器"), {
      target: { value: "canvaskit" },
    })
    expect(
      (await screen.findAllByText(/test unavailable/)).length
    ).toBeGreaterThan(0)
    await waitFor(() =>
      expect(document.querySelector("main")).toHaveAttribute(
        "data-render-state",
        "unavailable"
      )
    )
  })

  it("waits for CanvasKit and renders after the runtime is ready", async () => {
    let resolveRuntime: ((runtime: CanvasKitRuntime) => void) | undefined
    const loadCanvasKit = vi.fn(
      () =>
        new Promise<CanvasKitRuntime>((resolve) => {
          resolveRuntime = resolve
        })
    )
    render(<DesignLab loadCanvasKit={loadCanvasKit} />)

    fireEvent.change(screen.getByLabelText("渲染器"), {
      target: { value: "canvaskit" },
    })

    expect(await screen.findByText("正在加载 CanvasKit WASM…")).toBeTruthy()
    await act(async () => resolveRuntime?.(createCanvasKitRuntime()))
    await waitFor(() => {
      expect(loadCanvasKit).toHaveBeenCalledOnce()
      expect(document.querySelector("main")).toHaveAttribute(
        "data-render-state",
        "completed"
      )
      expect(
        screen
          .getByTestId("design-lab-canvas")
          .querySelector('canvas[data-renderer="canvaskit"]')
      ).toBeTruthy()
    })
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

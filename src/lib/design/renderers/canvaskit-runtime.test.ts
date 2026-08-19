import { describe, expect, it, vi } from "vitest"
import {
  loadCanvasKitRuntime,
  type CanvasKitInitializer,
  type CanvasKitRuntime,
} from "./canvaskit-runtime"

describe("loadCanvasKitRuntime", () => {
  it("loads the browser initializer from the local CanvasKit script", async () => {
    const runtime = { MakeCanvasSurface: vi.fn() }
    const initialize = vi.fn(async () => runtime as unknown as CanvasKitRuntime)
    const browserWindow = window as typeof window & {
      CanvasKitInit?: CanvasKitInitializer
    }

    const loading = loadCanvasKitRuntime()
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="/canvaskit/canvaskit.js"]'
    )
    expect(script).toBeTruthy()
    browserWindow.CanvasKitInit = initialize
    script?.dispatchEvent(new Event("load"))

    await expect(loading).resolves.toBe(runtime)
    delete browserWindow.CanvasKitInit
    script?.remove()
  })

  it("loads the WASM binary from the local Design Lab asset", async () => {
    const runtime = { MakeCanvasSurface: vi.fn() }
    const initialize = vi.fn(
      async () => runtime as unknown as CanvasKitRuntime
    ) as unknown as ReturnType<typeof vi.fn<CanvasKitInitializer>>

    const result = await loadCanvasKitRuntime(initialize)

    expect(result).toBe(runtime)
    const options = initialize.mock.calls[0]?.[0]
    expect(options?.locateFile("canvaskit.wasm")).toBe(
      "/canvaskit/canvaskit.wasm"
    )
    expect(options?.locateFile("canvaskit.data")).toBe(
      "/canvaskit/canvaskit.data"
    )
  })

  it("keeps the initialization error actionable", async () => {
    await expect(
      loadCanvasKitRuntime(async () => {
        throw new Error("WASM download failed")
      })
    ).rejects.toThrow("CanvasKit WASM 初始化失败：WASM download failed")
  })
})

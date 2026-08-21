import { describe, expect, it, vi } from "vitest"
import type { DesignDocument } from "../ast"
import { CanvasKitRenderer } from "./canvaskit-renderer"
import type { CanvasKitRuntime } from "./canvaskit-runtime"
import { DomSvgRenderer } from "./dom-svg-renderer"
import { WebglRenderer } from "./webgl-renderer"

const fixture: DesignDocument = {
  version: 1,
  revision: "fixture-r1",
  nodes: [
    { id: "root", type: "page", children: ["card", "title"] },
    {
      id: "card",
      type: "rectangle",
      parentId: "root",
      bounds: { x: 10, y: 10, width: 100, height: 80 },
    },
    {
      id: "title",
      type: "text",
      parentId: "root",
      bounds: { x: 20, y: 20, width: 80, height: 24 },
      text: "Hello",
    },
  ],
}

describe("renderer adapters", () => {
  it("renders the same AST through DOM/SVG and supports hit testing", () => {
    const renderer = new DomSvgRenderer()
    const host = document.createElement("div")
    renderer.load(fixture)
    const result = renderer.render({ width: 320, height: 240, scale: 1 }, host)
    expect(result.nodeCount).toBe(3)
    expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2)
    expect(renderer.hitTest({ x: 25, y: 25 })).toEqual(["card", "title"])
    expect(renderer.select({ x: 0, y: 0, width: 15, height: 15 })).toEqual([
      "card",
    ])
    expect(renderer.measureText("Hello").width).toBeGreaterThan(0)
    renderer.dispose()
    expect(host.childElementCount).toBe(0)
  })

  it("returns a visible diagnostic when CanvasKit is not configured", () => {
    const renderer = new CanvasKitRenderer()
    renderer.load(fixture)
    expect(renderer.capability.available).toBe(false)
    expect(renderer.capability.reason).toContain("WASM")
    expect(
      renderer.render({ width: 320, height: 240, scale: 1 }).element
    ).toBeUndefined()
  })

  it("draws the AST through an injected CanvasKit runtime", () => {
    const canvas = {
      clear: vi.fn(),
      scale: vi.fn(),
      drawRect: vi.fn(),
      drawText: vi.fn(),
    }
    const surface = {
      getCanvas: () => canvas,
      flush: vi.fn(),
      delete: vi.fn(),
    }
    const createdObjects: Array<{ delete: ReturnType<typeof vi.fn> }> = []
    class Paint {
      delete = vi.fn()
      setAntiAlias = vi.fn()
      setColor = vi.fn()
      setAlphaf = vi.fn()
      setStyle = vi.fn()
      setStrokeWidth = vi.fn()

      constructor() {
        createdObjects.push(this)
      }
    }
    class Font {
      delete = vi.fn()

      constructor(
        readonly face: null,
        readonly size: number
      ) {
        createdObjects.push(this)
      }
    }
    const runtime = {
      MakeCanvasSurface: () => surface,
      Paint,
      Font,
      PaintStyle: { Fill: { value: 0 }, Stroke: { value: 1 } },
      Color: vi.fn((red, green, blue, alpha = 1) => [
        red / 255,
        green / 255,
        blue / 255,
        alpha,
      ]),
      parseColorString: vi.fn(() => [0.1, 0.2, 0.3, 1]),
      XYWHRect: vi.fn((x, y, width, height) => [x, y, x + width, y + height]),
    } as unknown as CanvasKitRuntime
    const renderer = new CanvasKitRenderer(runtime)
    const host = document.createElement("div")
    renderer.load(fixture)
    const result = renderer.render({ width: 320, height: 240, scale: 1 }, host)
    expect(renderer.capability.available).toBe(true)
    expect(result.nodeCount).toBe(fixture.nodes.length)
    expect(canvas.clear).toHaveBeenCalledOnce()
    expect(canvas.drawRect).toHaveBeenCalledOnce()
    expect(canvas.drawText).toHaveBeenCalledWith(
      "Hello",
      20,
      36,
      expect.any(Paint),
      expect.any(Font)
    )
    expect(surface.flush).toHaveBeenCalledOnce()
    expect(host.querySelector("canvas")).toBeTruthy()
    renderer.dispose()
    expect(surface.delete).toHaveBeenCalledOnce()
    expect(
      createdObjects.every((entry) => entry.delete.mock.calls.length)
    ).toBe(true)
  })

  it("reports WebGL2 diagnostics in a non-GPU test environment", () => {
    const renderer = new WebglRenderer(
      () => ({ getContext: () => null }) as unknown as HTMLCanvasElement
    )
    renderer.load(fixture)
    expect(renderer.capability.available).toBe(false)
    expect(renderer.capability.reason).toContain("WebGL2")
    expect(renderer.hitTest({ x: 25, y: 25 })).toEqual(["card", "title"])
  })
})

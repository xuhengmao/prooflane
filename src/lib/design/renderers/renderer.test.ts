import { describe, expect, it } from "vitest"
import type { DesignDocument } from "../ast"
import { CanvasKitRenderer } from "./canvaskit-renderer"
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

  it("uses an injected CanvasKit runtime without changing AST semantics", () => {
    let flushed = false
    const renderer = new CanvasKitRenderer({
      MakeCanvasSurface: () => ({
        flush: () => {
          flushed = true
        },
      }),
    })
    const host = document.createElement("div")
    renderer.load(fixture)
    const result = renderer.render({ width: 320, height: 240, scale: 1 }, host)
    expect(renderer.capability.available).toBe(true)
    expect(result.nodeCount).toBe(fixture.nodes.length)
    expect(flushed).toBe(true)
    expect(host.querySelector("canvas")).toBeTruthy()
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

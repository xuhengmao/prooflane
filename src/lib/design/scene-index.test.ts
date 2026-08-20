import { describe, expect, it } from "vitest"

import type { DesignDocument } from "./ast"
import { createSceneIndex } from "./scene-index"

const document: DesignDocument = {
  version: 1,
  revision: "rev-42",
  nodes: [
    {
      id: "document",
      type: "document",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    },
    {
      id: "page",
      type: "page",
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    },
    {
      id: "back",
      type: "rectangle",
      bounds: { x: 10, y: 10, width: 100, height: 100 },
    },
    {
      id: "locked",
      type: "rectangle",
      locked: true,
      bounds: { x: 20, y: 20, width: 20, height: 20 },
    },
    {
      id: "hidden",
      type: "rectangle",
      visible: false,
      bounds: { x: 25, y: 25, width: 20, height: 20 },
    },
    {
      id: "container",
      type: "group",
      bounds: { x: 0, y: 0, width: 150, height: 150 },
    },
    {
      id: "front",
      type: "rectangle",
      bounds: { x: 30, y: 30, width: 40, height: 40 },
    },
    { id: "no-bounds", type: "shape" },
  ],
}

describe("SceneIndex", () => {
  it("queries visible geometric nodes in document order", () => {
    const index = createSceneIndex(document)

    expect(
      index.queryViewport({ x: 15, y: 15, width: 80, height: 80 })
    ).toEqual(["back", "locked", "container", "front"])
  })

  it("returns point hits from frontmost to backmost and excludes locked/document/page", () => {
    const index = createSceneIndex(document)

    expect(index.hitTestPoint({ x: 35, y: 35 })).toEqual([
      "front",
      "container",
      "back",
    ])
    expect(index.hitTestPoint({ x: 25, y: 25 })).toEqual(["container", "back"])
  })

  it("supports negative rectangles and boundary contact", () => {
    const index = createSceneIndex(document)

    expect(
      index.hitTestRect({ x: 70, y: 70, width: -60, height: -60 })
    ).toEqual(["back", "container", "front"])
    expect(index.queryViewport({ x: 110, y: 50, width: 1, height: 1 })).toEqual(
      ["back", "container"]
    )
  })

  it("exposes revision and makes dispose idempotent", () => {
    const index = createSceneIndex(document)
    expect(index.revision).toBe("rev-42")

    index.dispose()
    index.dispose()
    expect(
      index.queryViewport({ x: 0, y: 0, width: 500, height: 400 })
    ).toEqual([])
    expect(index.hitTestPoint({ x: 35, y: 35 })).toEqual([])
    expect(index.hitTestRect({ x: 0, y: 0, width: 1, height: 1 })).toEqual([])
  })
})

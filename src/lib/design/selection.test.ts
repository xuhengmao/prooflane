import { describe, expect, it } from "vitest"

import type { DesignDocument } from "./ast"
import {
  hitTestSelectionRect,
  rectIntersectsBounds,
  selectableNodes,
} from "./selection"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  nodes: [
    {
      id: "document",
      type: "document",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
    {
      id: "page",
      type: "page",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
    {
      id: "first",
      type: "rectangle",
      bounds: { x: 10, y: 10, width: 40, height: 30 },
    },
    {
      id: "locked",
      type: "rectangle",
      locked: true,
      bounds: { x: 60, y: 10, width: 40, height: 30 },
    },
    {
      id: "hidden",
      type: "rectangle",
      visible: false,
      bounds: { x: 110, y: 10, width: 40, height: 30 },
    },
    {
      id: "second",
      type: "text",
      bounds: { x: 200, y: 20, width: 20, height: 20 },
      text: "Two",
    },
  ],
}

describe("selection helpers", () => {
  it("returns selectable nodes in document order", () => {
    expect(selectableNodes(document).map((node) => node.id)).toEqual([
      "first",
      "second",
    ])
  })

  it("treats touching bounds as intersecting and supports negative rectangles", () => {
    expect(
      rectIntersectsBounds(
        { x: 50, y: 10, width: -40, height: 30 },
        { x: 10, y: 10, width: 40, height: 30 }
      )
    ).toBe(true)
    expect(
      rectIntersectsBounds(
        { x: 101, y: 10, width: -40, height: 30 },
        { x: 10, y: 10, width: 40, height: 30 }
      )
    ).toBe(false)
  })

  it("returns selectable nodes whose bounds intersect a marquee", () => {
    expect(
      hitTestSelectionRect(document, {
        x: 220,
        y: 40,
        width: -220,
        height: -40,
      })
    ).toEqual(["first", "second"])
  })
})

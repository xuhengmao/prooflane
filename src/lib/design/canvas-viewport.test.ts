import { describe, expect, it } from "vitest"

import type { DesignDocument } from "./ast"
import {
  clampZoom,
  clientPointToDocument,
  documentBounds,
  fitViewport,
  panViewport,
  zoomAroundPoint,
} from "./canvas-viewport"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  rootId: "root",
  nodes: [
    {
      id: "root",
      type: "frame",
      bounds: { x: 100, y: 50, width: 1440, height: 900 },
    },
    {
      id: "hidden",
      type: "rectangle",
      visible: false,
      bounds: { x: -1000, y: -1000, width: 10, height: 10 },
    },
  ],
}

describe("canvas viewport", () => {
  it("clamps zoom to 10% through 800%", () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(0)).toBe(0.1)
    expect(clampZoom(99)).toBe(8)
  })

  it("keeps the document anchor stable while zooming", () => {
    const viewport = {
      centerX: 500,
      centerY: 300,
      width: 1000,
      height: 600,
      zoom: 1,
    }
    const next = zoomAroundPoint(viewport, 2, { x: 700, y: 350 })

    expect(next.centerX - next.width / 2).toBeCloseTo(350)
    expect(next.centerY - next.height / 2).toBeCloseTo(175)
    expect(next.width).toBeCloseTo(500)
    expect(next.height).toBeCloseTo(300)
  })

  it("pans by document-space deltas without changing zoom", () => {
    const viewport = {
      centerX: 500,
      centerY: 300,
      width: 1000,
      height: 600,
      zoom: 1.5,
    }
    expect(panViewport(viewport, { x: -80, y: 40 })).toEqual({
      ...viewport,
      centerX: 420,
      centerY: 340,
    })
  })

  it("uses the root frame for document bounds", () => {
    expect(documentBounds(document)).toEqual({
      x: 100,
      y: 50,
      width: 1440,
      height: 900,
    })
  })

  it("fits bounds inside a host while preserving aspect ratio", () => {
    const viewport = fitViewport(
      { x: 100, y: 50, width: 1440, height: 900 },
      { width: 1000, height: 700 },
      48
    )

    expect(viewport.centerX).toBe(820)
    expect(viewport.centerY).toBe(500)
    expect(viewport.width).toBeCloseTo(1592.920354)
    expect(viewport.height).toBeCloseTo(1115.044248)
    expect(viewport.zoom).toBeCloseTo(0.627778)
  })

  it("converts client coordinates using the current viewBox", () => {
    const point = clientPointToDocument(
      { x: 250, y: 150 },
      { left: 50, top: 50, width: 400, height: 200 },
      { centerX: 500, centerY: 300, width: 800, height: 400, zoom: 1 }
    )
    expect(point).toEqual({ x: 500, y: 300 })
  })

  it("returns safe values for an invalid host", () => {
    const viewport = fitViewport(
      { x: 10, y: 20, width: 100, height: 50 },
      { width: 0, height: -2 },
      48
    )
    expect(viewport).toEqual({
      centerX: 60,
      centerY: 45,
      width: 100,
      height: 50,
      zoom: 1,
    })
  })
})

import { describe, expect, it } from "vitest"

import { createGridDocument } from "./scene-index-fixtures"
import { createSceneIndex } from "./scene-index"

const sizes = [100, 1_000, 10_000]

describe("SceneIndex fixed-grid benchmark", () => {
  it.each(sizes)("matches reference queries for %i nodes", (count) => {
    const document = createGridDocument(count)
    const index = createSceneIndex(document)
    const viewport = { x: 0, y: 0, width: 420, height: 320 }
    const point = { x: 24, y: 24 }
    const rect = { x: 320, y: 240, width: -280, height: -200 }

    expect(index.queryViewport(viewport)).toEqual(
      referenceViewport(document.nodes, viewport)
    )
    expect(index.hitTestPoint(point)).toEqual(
      referencePoint(document.nodes, point)
    )
    expect(index.hitTestRect(rect)).toEqual(referenceRect(document.nodes, rect))
    index.dispose()
  })

  it.each(sizes)("records deterministic timings for %i nodes", (count) => {
    const document = createGridDocument(count)
    const start = performance.now()
    const index = createSceneIndex(document)
    const buildMs = performance.now() - start
    const viewport = { x: 0, y: 0, width: 420, height: 320 }
    const point = { x: 24, y: 24 }
    const rect = { x: 320, y: 240, width: -280, height: -200 }

    index.queryViewport(viewport)
    index.hitTestPoint(point)
    index.hitTestRect(rect)

    const samples: number[] = []
    for (let i = 0; i < 25; i += 1) {
      const queryStart = performance.now()
      index.queryViewport(viewport)
      index.hitTestPoint(point)
      index.hitTestRect(rect)
      samples.push(performance.now() - queryStart)
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
    console.info(
      `[SceneIndex] nodes=${count} build=${buildMs.toFixed(3)}ms median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`
    )
    if (count === 10_000 && p95 >= 16) {
      console.warn(
        `[SceneIndex] 10,000-node query p95 exceeded 16ms: ${p95.toFixed(3)}ms`
      )
    }
    expect(Number.isFinite(buildMs)).toBe(true)
    expect(Number.isFinite(median)).toBe(true)
    expect(Number.isFinite(p95)).toBe(true)
    index.dispose()
  })
})

function referenceViewport(
  nodes: ReturnType<typeof createGridDocument>["nodes"],
  viewport: ViewportRect
): string[] {
  return nodes
    .filter(
      (node) =>
        node.visible !== false &&
        node.type !== "document" &&
        node.type !== "page" &&
        node.bounds &&
        intersects(viewport, node.bounds)
    )
    .map((node) => node.id)
}

function referencePoint(
  nodes: ReturnType<typeof createGridDocument>["nodes"],
  point: { x: number; y: number }
): string[] {
  return nodes
    .filter(
      (node) =>
        node.visible !== false &&
        node.locked !== true &&
        node.type !== "document" &&
        node.type !== "page" &&
        node.bounds &&
        contains(node.bounds, point)
    )
    .map((node) => node.id)
    .reverse()
}

function referenceRect(
  nodes: ReturnType<typeof createGridDocument>["nodes"],
  rect: ViewportRect
): string[] {
  return nodes
    .filter(
      (node) =>
        node.visible !== false &&
        node.locked !== true &&
        node.type !== "document" &&
        node.type !== "page" &&
        node.bounds &&
        intersects(rect, node.bounds)
    )
    .map((node) => node.id)
}

type ViewportRect = { x: number; y: number; width: number; height: number }

function normalize(rect: ViewportRect): ViewportRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

function intersects(a: ViewportRect, b: ViewportRect): boolean {
  const left = normalize(a)
  const right = normalize(b)
  return !(
    left.x + left.width < right.x ||
    right.x + right.width < left.x ||
    left.y + left.height < right.y ||
    right.y + right.height < left.y
  )
}

function contains(
  bounds: ViewportRect,
  point: { x: number; y: number }
): boolean {
  const rect = normalize(bounds)
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

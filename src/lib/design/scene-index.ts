import type { DesignBounds, DesignDocument } from "./ast"

interface GeometryRecord {
  id: string
  type: string
  locked: boolean
  bounds: DesignBounds
}

export interface SceneIndex {
  readonly revision: string
  queryViewport(viewport: DesignBounds): string[]
  hitTestPoint(point: { x: number; y: number }): string[]
  hitTestRect(rect: DesignBounds): string[]
  dispose(): void
}

export function createSceneIndex(document: DesignDocument): SceneIndex {
  const revision = document.revision
  let records: GeometryRecord[] | undefined = document.nodes
    .filter((node) => node.visible !== false && node.bounds !== undefined)
    .map((node) => ({
      id: node.id,
      type: node.type,
      locked: node.locked === true,
      bounds: normalizeRect(node.bounds!),
    }))

  const activeRecords = (): GeometryRecord[] => records ?? []

  return {
    revision,
    queryViewport(viewport) {
      const normalizedViewport = normalizeRect(viewport)
      return activeRecords()
        .filter(
          (record) =>
            record.type !== "document" &&
            record.type !== "page" &&
            rectIntersectsBounds(normalizedViewport, record.bounds)
        )
        .map((record) => record.id)
    },
    hitTestPoint(point) {
      return activeRecords()
        .filter(
          (record) =>
            !record.locked &&
            record.type !== "document" &&
            record.type !== "page" &&
            containsPoint(record.bounds, point)
        )
        .map((record) => record.id)
        .reverse()
    },
    hitTestRect(rect) {
      const normalizedRect = normalizeRect(rect)
      return activeRecords()
        .filter(
          (record) =>
            !record.locked &&
            record.type !== "document" &&
            record.type !== "page" &&
            rectIntersectsBounds(normalizedRect, record.bounds)
        )
        .map((record) => record.id)
    },
    dispose() {
      records = undefined
    },
  }
}

function normalizeRect(rect: DesignBounds): DesignBounds {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

function rectIntersectsBounds(
  rect: DesignBounds,
  bounds: DesignBounds
): boolean {
  return !(
    rect.x + rect.width < bounds.x ||
    bounds.x + bounds.width < rect.x ||
    rect.y + rect.height < bounds.y ||
    bounds.y + bounds.height < rect.y
  )
}

function containsPoint(
  bounds: DesignBounds,
  point: { x: number; y: number }
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

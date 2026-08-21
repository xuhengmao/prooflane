import type { DesignBounds, DesignDocument, DesignNode } from "./ast"

export function selectableNodes(document: DesignDocument): DesignNode[] {
  return document.nodes.filter(
    (node) =>
      node.visible !== false &&
      node.locked !== true &&
      node.type !== "document" &&
      node.type !== "page" &&
      Boolean(node.bounds)
  )
}

export function rectIntersectsBounds(
  rect: DesignBounds,
  bounds: DesignBounds
): boolean {
  const normalizedRect = normalizeRect(rect)
  const normalizedBounds = normalizeRect(bounds)
  return !(
    normalizedRect.x + normalizedRect.width < normalizedBounds.x ||
    normalizedBounds.x + normalizedBounds.width < normalizedRect.x ||
    normalizedRect.y + normalizedRect.height < normalizedBounds.y ||
    normalizedBounds.y + normalizedBounds.height < normalizedRect.y
  )
}

export function hitTestSelectionRect(
  document: DesignDocument,
  rect: DesignBounds
): string[] {
  return selectableNodes(document)
    .filter((node) => node.bounds && rectIntersectsBounds(rect, node.bounds))
    .map((node) => node.id)
}

function normalizeRect(rect: DesignBounds): DesignBounds {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

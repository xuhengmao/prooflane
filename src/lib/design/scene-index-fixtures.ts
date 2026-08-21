import type { DesignDocument } from "./ast"

/** Creates a deterministic grid used by SceneIndex correctness and timing tests. */
export function createGridDocument(count: number): DesignDocument {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("count must be a non-negative integer")
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
  return {
    version: 1,
    revision: `grid-${count}`,
    nodes: Array.from({ length: count }, (_, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      return {
        id: `node-${index}`,
        type: "rectangle" as const,
        bounds: {
          x: column * 72,
          y: row * 56,
          width: 48,
          height: 36,
        },
      }
    }),
  }
}

export type DesignNodeType = "group" | "frame" | "text" | "shape" | "image"

export interface DesignNode {
  id: string
  type: DesignNodeType
  parentId?: string
  locked?: boolean
  text?: string
  [key: string]: unknown
}

export interface DesignDocument {
  version: 1
  revision: string
  nodes: DesignNode[]
  rootId?: string
}

export type ValidationErrorCode =
  | "duplicate_id"
  | "parent_cycle"
  | "unknown_type"
  | "missing_field"
  | "missing_parent"
export interface ValidationError {
  code: ValidationErrorCode
  message: string
  nodeId?: string
}
export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
  document?: DesignDocument
}

const nodeTypes = new Set<DesignNodeType>([
  "group",
  "frame",
  "text",
  "shape",
  "image",
])

export function validateDesignDocument(
  document: DesignDocument
): ValidationResult {
  const errors: ValidationError[] = []
  const seen = new Set<string>()
  for (const node of document.nodes) {
    if (seen.has(node.id))
      errors.push({
        code: "duplicate_id",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      })
    seen.add(node.id)
  }
  const ids = new Set(document.nodes.map((node) => node.id))
  for (const node of document.nodes) {
    if (!nodeTypes.has(node.type))
      errors.push({
        code: "unknown_type",
        message: `Unknown node type: ${String(node.type)}`,
        nodeId: node.id,
      })
    if (node.type === "text" && typeof node.text !== "string")
      errors.push({
        code: "missing_field",
        message: "Text node requires text",
        nodeId: node.id,
      })
    if (node.parentId && !ids.has(node.parentId))
      errors.push({
        code: "missing_parent",
        message: `Missing parent: ${node.parentId}`,
        nodeId: node.id,
      })
  }
  const state = new Map<string, number>()
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  const visit = (id: string): void => {
    if (state.get(id) === 1) {
      errors.push({
        code: "parent_cycle",
        message: `Parent cycle at ${id}`,
        nodeId: id,
      })
      return
    }
    if (state.get(id) === 2) return
    state.set(id, 1)
    const parent = byId.get(id)?.parentId
    if (parent && byId.has(parent)) visit(parent)
    state.set(id, 2)
  }
  for (const node of document.nodes) visit(node.id)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    errors: [],
    document: {
      ...document,
      nodes: document.nodes
        .map((node) => ({ ...node }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
  }
}

import {
  validateDesignDocument,
  type DesignDocument,
  type DesignNode,
} from "./ast"

export type Command =
  | { type: "CreateNode"; node: DesignNode }
  | { type: "UpdateNode"; id: string; patch: Partial<DesignNode> }
  | { type: "MoveNode"; id: string; parentId?: string }
  | { type: "SetText"; id: string; text: string }
  | { type: "DeleteNode"; id: string }
export interface CommandError {
  code: string
  message: string
}
export interface CommandResult {
  ok: boolean
  document: DesignDocument
  inverse?: Command
  beforeRevision: string
  afterRevision: string
  error?: CommandError
}

export function revisionOf(document: DesignDocument): string {
  const input = JSON.stringify({
    version: document.version,
    rootId: document.rootId,
    nodes: document.nodes,
  })
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
const clone = (document: DesignDocument): DesignDocument =>
  JSON.parse(JSON.stringify(document)) as DesignDocument
const fail = (
  doc: DesignDocument,
  code: string,
  message: string
): CommandResult => ({
  ok: false,
  document: doc,
  beforeRevision: doc.revision,
  afterRevision: doc.revision,
  error: { code, message },
})

export function applyCommand(
  document: DesignDocument,
  command: Command
): CommandResult {
  const working = clone(document)
  const index = working.nodes.findIndex(
    (node) => node.id === ("id" in command ? command.id : command.node.id)
  )
  let inverse: Command
  if (command.type === "CreateNode") {
    if (working.nodes.some((node) => node.id === command.node.id))
      return fail(document, "duplicate_id", "Node id already exists")
    if (
      command.node.parentId &&
      !working.nodes.some((node) => node.id === command.node.parentId)
    )
      return fail(document, "missing_parent", "Parent does not exist")
    working.nodes.push({ ...command.node })
    inverse = { type: "DeleteNode", id: command.node.id }
  } else {
    if (index < 0) return fail(document, "not_found", "Node not found")
    const target = working.nodes[index]
    if (target.locked) return fail(document, "locked", "Node is locked")
    if (command.type === "UpdateNode") {
      inverse = { type: "UpdateNode", id: command.id, patch: { ...target } }
      working.nodes[index] = {
        ...target,
        ...command.patch,
        id: target.id,
        type: target.type,
      }
    } else if (command.type === "MoveNode") {
      inverse = { type: "MoveNode", id: command.id, parentId: target.parentId }
      target.parentId = command.parentId
    } else if (command.type === "SetText") {
      if (target.type !== "text")
        return fail(document, "invalid_type", "SetText requires a Text node")
      inverse = { type: "SetText", id: command.id, text: target.text ?? "" }
      target.text = command.text
    } else {
      inverse = { type: "CreateNode", node: { ...target } }
      working.nodes.splice(index, 1)
      for (const node of working.nodes)
        if (node.parentId === command.id) node.parentId = target.parentId
    }
  }
  const validation = validateDesignDocument(working)
  if (!validation.ok)
    return fail(
      document,
      validation.errors[0].code,
      validation.errors[0].message
    )
  const next = { ...working, revision: revisionOf(working) }
  return {
    ok: true,
    document: next,
    inverse,
    beforeRevision: document.revision,
    afterRevision: next.revision,
  }
}

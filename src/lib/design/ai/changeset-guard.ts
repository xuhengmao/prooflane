import type { DesignDocument } from "../ast"
import { applyChangeSet, type ChangeSet } from "../changeset"
import type { Command } from "../commands"

type UnknownRecord = Record<string, unknown>

const commandTypes = new Set([
  "CreateNode",
  "UpdateNode",
  "MoveNode",
  "SetText",
  "DeleteNode",
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasString(record: UnknownRecord, key: string): boolean {
  return typeof record[key] === "string" && record[key] !== ""
}

function isRuntimeCommand(value: unknown): value is Command {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (!commandTypes.has(value.type)) return false
  if (value.type === "CreateNode") {
    return (
      isRecord(value.node) &&
      hasString(value.node, "id") &&
      hasString(value.node, "type")
    )
  }
  if (!hasString(value, "id")) return false
  if (value.type === "UpdateNode") return isRecord(value.patch)
  if (value.type === "MoveNode")
    return value.parentId === undefined || typeof value.parentId === "string"
  if (value.type === "SetText") return typeof value.text === "string"
  return true
}

/** Validate untrusted provider output before any command property is read. */
export function validateChangeSetShape(input: unknown): GuardResult {
  if (!isRecord(input)) return { ok: false, errors: ["invalid_changeset"] }
  const errors: string[] = []
  if (!hasString(input, "baseRevision")) errors.push("missing_base_revision")
  if (!Array.isArray(input.operations)) {
    errors.push("missing_operations")
  } else if (input.operations.length === 0) {
    errors.push("empty_changeset")
  } else {
    for (const operation of input.operations) {
      if (!isRecord(operation) || typeof operation.type !== "string") {
        errors.push("invalid_command")
      } else if (!commandTypes.has(operation.type)) {
        errors.push("unknown_command")
      } else if (!isRuntimeCommand(operation)) {
        errors.push("invalid_command")
      }
    }
  }
  const unique = [...new Set(errors)]
  return unique.length
    ? { ok: false, errors: unique }
    : { ok: true, errors: [] }
}

export interface ChangeSetGuardScope {
  allowedNodeIds?: string[]
  allowCreate?: boolean
}

export interface GuardResult {
  ok: boolean
  errors: string[]
}

export interface PreviewModel {
  beforeRevision: string
  afterRevision?: string
  addedNodeIds: string[]
  removedNodeIds: string[]
  changedNodeIds: string[]
  operations: number
  riskLevel: "low" | "medium" | "high"
}

function targetId(command: Command): string {
  return command.type === "CreateNode" ? command.node.id : command.id
}

function containsPathEscape(value: string): boolean {
  const normalized = value.replace(/\\/g, "/")
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  )
}

export function validateChangeSet(
  changeSet: ChangeSet,
  document: DesignDocument,
  scope: ChangeSetGuardScope = {}
): GuardResult {
  const shape = validateChangeSetShape(changeSet)
  if (!shape.ok) return shape
  const candidate = changeSet as ChangeSet
  const errors: string[] = []
  if (candidate.baseRevision !== document.revision)
    errors.push("revision_conflict")
  const allowed = scope.allowedNodeIds
    ? new Set(scope.allowedNodeIds)
    : undefined
  for (const operation of candidate.operations) {
    if (operation.type === "CreateNode" && !scope.allowCreate)
      errors.push("create_not_allowed")
    const id = targetId(operation)
    if (allowed && !allowed.has(id)) errors.push("scope_violation")
    if (operation.type === "UpdateNode") {
      if (
        operation.patch.assetRef &&
        containsPathEscape(operation.patch.assetRef)
      )
        errors.push("asset_path_escape")
      if (
        operation.patch.parentId &&
        allowed &&
        !allowed.has(operation.patch.parentId)
      )
        errors.push("parent_scope_violation")
    }
    if (operation.type === "CreateNode") {
      if (
        operation.node.parentId &&
        allowed &&
        !allowed.has(operation.node.parentId)
      )
        errors.push("parent_scope_violation")
      if (
        operation.node.assetRef &&
        containsPathEscape(operation.node.assetRef)
      )
        errors.push("asset_path_escape")
    }
    if (
      operation.type === "MoveNode" &&
      operation.parentId &&
      allowed &&
      !allowed.has(operation.parentId)
    )
      errors.push("parent_scope_violation")
  }
  const unique = [...new Set(errors)]
  if (unique.length) return { ok: false, errors: unique }
  const applied = applyChangeSet(document, candidate)
  if (!applied.ok)
    return { ok: false, errors: [applied.error?.code ?? "changeset_invalid"] }
  return { ok: true, errors: [] }
}

export function previewChangeSet(
  document: DesignDocument,
  changeSet: ChangeSet,
  riskLevel: PreviewModel["riskLevel"] = "medium"
): PreviewModel {
  const guard = validateChangeSet(changeSet, document)
  if (!guard.ok) throw new Error(guard.errors.join(","))
  const result = applyChangeSet(document, changeSet)
  const before = new Map(document.nodes.map((node) => [node.id, node]))
  const after = new Map(result.document.nodes.map((node) => [node.id, node]))
  return {
    beforeRevision: document.revision,
    afterRevision: result.document.revision,
    addedNodeIds: [...after.keys()].filter((id) => !before.has(id)),
    removedNodeIds: [...before.keys()].filter((id) => !after.has(id)),
    changedNodeIds: [...after.keys()].filter(
      (id) =>
        before.has(id) &&
        JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))
    ),
    operations: changeSet.operations.length,
    riskLevel,
  }
}

import type { DesignDocument } from "../ast"
import { applyChangeSet, type ChangeSet } from "../changeset"
import type { Command } from "../commands"

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
  const errors: string[] = []
  if (changeSet.baseRevision !== document.revision)
    errors.push("revision_conflict")
  const allowed = scope.allowedNodeIds
    ? new Set(scope.allowedNodeIds)
    : undefined
  for (const operation of changeSet.operations) {
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
  const applied = applyChangeSet(document, changeSet)
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

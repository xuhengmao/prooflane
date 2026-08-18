import type { DesignDocument } from "./ast"
import { applyCommand, type Command, type CommandError } from "./commands"

export interface ChangeSet {
  id: string
  baseRevision: string
  operations: Command[]
}
export interface ChangeSetInput {
  id?: string
  baseRevision: string
  operations: Command[]
}
export interface ApplyResult {
  ok: boolean
  document: DesignDocument
  error?: CommandError
  applied: number[]
  inverse?: Command[]
}
export function createChangeSet(input: ChangeSetInput): ChangeSet {
  return {
    id: input.id ?? `cs-${Date.now()}`,
    baseRevision: input.baseRevision,
    operations: input.operations.map(
      (operation) => JSON.parse(JSON.stringify(operation)) as Command
    ),
  }
}
export function applyChangeSet(
  document: DesignDocument,
  changeSet: ChangeSet,
  selection?: number[]
): ApplyResult {
  if (changeSet.baseRevision !== document.revision)
    return {
      ok: false,
      document,
      applied: [],
      error: {
        code: "revision_conflict",
        message: "ChangeSet base revision is stale",
      },
    }
  if (
    selection?.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= changeSet.operations.length
    )
  )
    return {
      ok: false,
      document,
      applied: [],
      error: {
        code: "invalid_selection",
        message: "ChangeSet selection contains an invalid operation index",
      },
    }
  const selected = selection
    ? changeSet.operations
        .map((_, index) => index)
        .filter((index) => selection.includes(index))
    : changeSet.operations.map((_, index) => index)
  let current = document
  const inverse: Command[] = []
  for (const index of selected) {
    const result = applyCommand(current, changeSet.operations[index])
    if (!result.ok)
      return { ok: false, document, applied: [], error: result.error }
    current = result.document
    if (result.inverse) inverse.unshift(result.inverse)
  }
  return { ok: true, document: current, applied: selected, inverse }
}

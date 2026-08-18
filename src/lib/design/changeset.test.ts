import { describe, expect, it } from "vitest"
import { createChangeSet, applyChangeSet } from "./changeset"
import type { DesignDocument } from "./ast"

const base: DesignDocument = {
  version: 1,
  revision: "r0",
  nodes: [{ id: "root", type: "group" }],
}

describe("change sets", () => {
  it("creates commands without changing AST and applies all or selected operations", () => {
    const changeSet = createChangeSet({
      baseRevision: "r0",
      operations: [
        {
          type: "CreateNode",
          node: { id: "a", type: "text", parentId: "root", text: "a" },
        },
        {
          type: "CreateNode",
          node: { id: "b", type: "text", parentId: "root", text: "b" },
        },
      ],
    })
    expect(base.nodes).toHaveLength(1)
    expect(applyChangeSet(base, changeSet).document.nodes).toHaveLength(3)
    expect(
      applyChangeSet(base, changeSet, [1]).document.nodes.map((n) => n.id)
    ).toEqual(["root", "b"])
  })

  it("returns revision_conflict for stale changesets", () => {
    const cs = createChangeSet({ baseRevision: "old", operations: [] })
    const result = applyChangeSet(base, cs)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("revision_conflict")
  })
})

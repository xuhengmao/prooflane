import { describe, expect, it } from "vitest"
import { applyCommand, type Command } from "./commands"
import type { DesignDocument } from "./ast"

const base: DesignDocument = {
  version: 1,
  revision: "r0",
  nodes: [{ id: "root", type: "group" }],
}

describe("design commands", () => {
  it("applies commands immutably and returns inverse", () => {
    const command: Command = {
      type: "CreateNode",
      node: { id: "t", type: "text", parentId: "root", text: "hello" },
    }
    const result = applyCommand(base, command)
    expect(result.ok).toBe(true)
    expect(result.document).not.toBe(base)
    expect(result.document.nodes.some((n) => n.id === "t")).toBe(true)
    expect(result.inverse).toEqual({ type: "DeleteNode", id: "t" })
    expect(result.beforeRevision).toBe("r0")
    expect(result.afterRevision).not.toBe("r0")
  })

  it("rolls back a failed command without mutating source", () => {
    const before = JSON.stringify(base)
    const result = applyCommand(base, {
      type: "UpdateNode",
      id: "missing",
      patch: { locked: true },
    })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(base)).toBe(before)
  })

  it("supports move, set text, and locked-node rejection", () => {
    const withNodes: DesignDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: "g", type: "group" },
        { id: "t", type: "text", parentId: "root", text: "a", locked: true },
      ],
    }
    expect(
      applyCommand(withNodes, { type: "MoveNode", id: "g", parentId: "root" })
        .ok
    ).toBe(true)
    expect(
      applyCommand(withNodes, { type: "SetText", id: "t", text: "b" }).error
        ?.code
    ).toBe("locked")
  })
})

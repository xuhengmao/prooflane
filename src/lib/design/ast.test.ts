import { describe, expect, it } from "vitest"
import { validateDesignDocument, type DesignDocument } from "./ast"

const doc = (nodes: DesignDocument["nodes"]): DesignDocument => ({
  version: 1,
  revision: "r0",
  nodes,
})

describe("Design AST", () => {
  it("rejects duplicate ids and parent cycles", () => {
    const result = validateDesignDocument(
      doc([
        { id: "a", type: "group", parentId: "b" },
        { id: "a", type: "text", parentId: "b", text: "x" },
        { id: "b", type: "group", parentId: "a" },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual([
      "duplicate_id",
      "parent_cycle",
    ])
  })

  it("rejects unknown node types and missing required text", () => {
    const result = validateDesignDocument(
      doc([
        { id: "x", type: "unknown" as never },
        { id: "t", type: "text" },
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual([
      "unknown_type",
      "missing_field",
    ])
  })

  it("accepts the complete v1 node vocabulary and rejects non-Text text fields", () => {
    const result = validateDesignDocument(
      doc([
        { id: "document", type: "document" },
        { id: "page", type: "page", parentId: "document" },
        { id: "frame", type: "frame", parentId: "page" },
        { id: "group", type: "group", parentId: "frame" },
        { id: "rectangle", type: "rectangle", parentId: "group" },
        { id: "shape", type: "shape", parentId: "group" },
        { id: "text", type: "text", parentId: "group", text: "hello" },
        {
          id: "image",
          type: "image",
          parentId: "group",
          assetRef: "assets/a.png",
        },
      ])
    )
    expect(result.ok).toBe(true)
    expect(
      validateDesignDocument(doc([{ id: "shape", type: "shape", text: "bad" }]))
        .errors[0].code
    ).toBe("invalid_field")
  })

  it("does not mutate input and produces stable ordering", () => {
    const input = doc([
      { id: "b", type: "group" },
      { id: "a", type: "shape" },
    ])
    const before = JSON.stringify(input)
    const result = validateDesignDocument(input)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(input)).toBe(before)
    expect(result.document?.nodes.map((node) => node.id)).toEqual(["a", "b"])
  })
})

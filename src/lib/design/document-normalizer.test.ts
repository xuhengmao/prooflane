import { describe, expect, it } from "vitest"

import type { DesignDocument } from "./ast"
import {
  createBlankDesignDocument,
  normalizeDesignDocument,
} from "./document-normalizer"

describe("design document normalizer", () => {
  it("creates a stable 1440 by 900 starter document", () => {
    const document = createBlankDesignDocument()

    expect(document.rootId).toBe("root-frame")
    expect(document.nodes.map((node) => node.id)).toEqual([
      "background-rectangle",
      "root-frame",
      "title-text",
    ])
    expect(
      document.nodes.find((node) => node.id === "root-frame")?.bounds
    ).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
    expect(document.nodes.find((node) => node.id === "title-text")?.text).toBe(
      "Hello，Prooflane"
    )
    expect(document.revision).not.toBe("")
  })

  it("normalizes the current placeholder document to the starter template", () => {
    const input = {
      schemaVersion: 1,
      brief: "A local AI design workspace",
      pages: [{ id: "page-1", type: "page", name: "Page 1" }],
    }
    const before = JSON.stringify(input)

    const result = normalizeDesignDocument(input)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a normalized document")
    expect(result.createdFromTemplate).toBe(true)
    expect(result.document.rootId).toBe("root-frame")
    expect(JSON.stringify(input)).toBe(before)
  })

  it("accepts an existing valid document without replacing its content", () => {
    const input: DesignDocument = {
      version: 1,
      revision: "existing-revision",
      rootId: "frame-a",
      nodes: [
        {
          id: "frame-a",
          type: "frame",
          bounds: { x: 10, y: 20, width: 800, height: 600 },
        },
        {
          id: "text-a",
          type: "text",
          parentId: "frame-a",
          bounds: { x: 24, y: 32, width: 200, height: 40 },
          text: "Existing title",
        },
      ],
    }

    const result = normalizeDesignDocument(input)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a normalized document")
    expect(result.createdFromTemplate).toBe(false)
    expect(result.document.revision).toBe("existing-revision")
    expect(
      result.document.nodes.find((node) => node.id === "text-a")?.text
    ).toBe("Existing title")
  })

  it.each([
    ["non-object", "broken"],
    [
      "unknown node type",
      {
        version: 1,
        revision: "r1",
        nodes: [{ id: "x", type: "unknown" }],
      },
    ],
    [
      "duplicate ids",
      {
        version: 1,
        revision: "r1",
        nodes: [
          { id: "x", type: "group" },
          { id: "x", type: "group" },
        ],
      },
    ],
    [
      "missing parent",
      {
        version: 1,
        revision: "r1",
        nodes: [{ id: "x", type: "rectangle", parentId: "missing" }],
      },
    ],
    [
      "negative bounds",
      {
        version: 1,
        revision: "r1",
        nodes: [
          {
            id: "x",
            type: "rectangle",
            bounds: { x: 0, y: 0, width: -1, height: 10 },
          },
        ],
      },
    ],
  ])("rejects %s without creating a template", (_label, input) => {
    const result = normalizeDesignDocument(input)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected normalization to fail")
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

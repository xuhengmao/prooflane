import { describe, expect, it } from "vitest"
import type { DesignDocument } from "../ast"
import { createChangeSet } from "../changeset"
import { validateChangeSet, previewChangeSet } from "./changeset-guard"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  nodes: [{ id: "title", type: "text", text: "Before" }],
}

describe("ChangeSet guard", () => {
  it("rejects revision conflicts and out-of-scope targets before preview", () => {
    const stale = createChangeSet({
      baseRevision: "old",
      operations: [{ type: "SetText", id: "title", text: "x" }],
    })
    expect(validateChangeSet(stale, document)).toEqual({
      ok: false,
      errors: ["revision_conflict"],
    })
    const outOfScope = createChangeSet({
      baseRevision: "r1",
      operations: [{ type: "SetText", id: "title", text: "x" }],
    })
    expect(
      validateChangeSet(outOfScope, document, { allowedNodeIds: ["other"] })
    ).toEqual({ ok: false, errors: ["scope_violation"] })
  })

  it("rejects path escapes and never mutates the original document", () => {
    const changeSet = createChangeSet({
      baseRevision: "r1",
      operations: [
        { type: "UpdateNode", id: "title", patch: { assetRef: "../secret" } },
      ],
    })
    expect(validateChangeSet(changeSet, document)).toEqual({
      ok: false,
      errors: ["asset_path_escape"],
    })
    expect(document.nodes[0].text).toBe("Before")
  })

  it("returns a preview model only after guard approval", () => {
    const changeSet = createChangeSet({
      baseRevision: "r1",
      operations: [{ type: "SetText", id: "title", text: "After" }],
    })
    const preview = previewChangeSet(document, changeSet, "low")
    expect(preview).toMatchObject({
      beforeRevision: "r1",
      operations: 1,
      changedNodeIds: ["title"],
      riskLevel: "low",
    })
  })
})

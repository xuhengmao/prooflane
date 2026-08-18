import { describe, expect, it } from "vitest"
import type { DesignDocument } from "./ast"
import { sha256Hex, validatePackageManifest } from "./package"

const document: DesignDocument = { version: 1, revision: "r1", nodes: [] }
const validManifest = {
  formatVersion: 1 as const,
  designId: "design-1",
  astSha256: sha256Hex(JSON.stringify(document)),
  assetRefs: ["assets/logo.png"],
}

describe("proofdesign package manifest", () => {
  it("accepts a valid manifest and document", () => {
    expect(validatePackageManifest(validManifest, document)).toEqual({
      ok: true,
      errors: [],
    })
  })

  it("rejects unsupported versions, invalid hashes, and escaping assets", () => {
    const result = validatePackageManifest(
      {
        ...validManifest,
        formatVersion: 2 as never,
        astSha256: "bad",
        assetRefs: ["../secret"],
      },
      document
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([
      "unsupported_format_version",
      "invalid_ast_hash",
      "asset_path_escape",
    ])
  })

  it("rejects a valid-looking hash that does not match the AST", () => {
    const result = validatePackageManifest(
      { ...validManifest, astSha256: "a".repeat(64) },
      document
    )
    expect(result.ok).toBe(false)
    expect(result.errors).toContain("ast_hash_mismatch")
  })

  it.each([
    "/tmp/file",
    "C:\\\\tmp\\\\file",
    "assets\\\\..\\\\secret",
    "../secret",
  ])("rejects absolute or escaping asset path %s", (assetRef) => {
    const result = validatePackageManifest(
      { ...validManifest, assetRefs: [assetRef] },
      document
    )
    expect(result.errors).toContain("asset_path_escape")
  })

  it("rejects an AST with an unsupported version", () => {
    const result = validatePackageManifest(validManifest, {
      ...document,
      version: 2 as never,
    })
    expect(result.errors).toContain("unsupported_ast_version")
  })
})

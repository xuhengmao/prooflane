import { describe, expect, it, vi } from "vitest"

import {
  createDesignArtifact,
  listDesignArtifacts,
  saveDesignRevision,
} from "./artifact-service"

describe("DesignArtifactService", () => {
  it("uses the desktop command names and camelCase payloads", async () => {
    const invoke = vi.fn().mockResolvedValue([])

    await listDesignArtifacts(invoke, true)
    await createDesignArtifact(invoke, {
      name: "首页",
      kind: "page",
      projectFolderId: null,
      document: { schemaVersion: 1, pages: [] },
    })
    await saveDesignRevision(invoke, {
      artifactId: "artifact-1",
      expectedRevisionId: "revision-1",
      schemaVersion: 1,
      document: { schemaVersion: 1, pages: [] },
    })

    expect(invoke).toHaveBeenNthCalledWith(1, "list_design_artifacts", {
      includeArchived: true,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, "create_design_artifact", {
      input: {
        name: "首页",
        kind: "page",
        projectFolderId: null,
        document: { schemaVersion: 1, pages: [] },
      },
    })
    expect(invoke).toHaveBeenNthCalledWith(3, "save_design_revision", {
      input: {
        artifactId: "artifact-1",
        expectedRevisionId: "revision-1",
        schemaVersion: 1,
        document: { schemaVersion: 1, pages: [] },
      },
    })
  })

  it("does not swallow desktop command failures", async () => {
    const error = new Error("database unavailable")
    const invoke = vi.fn().mockRejectedValue(error)

    await expect(listDesignArtifacts(invoke, false)).rejects.toBe(error)
  })
})

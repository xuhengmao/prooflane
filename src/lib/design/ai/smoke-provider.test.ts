import { describe, expect, it } from "vitest"
import { OptInRealModelSmokeProvider } from "./smoke-provider"

describe("real model smoke seam", () => {
  it("does not contact a model unless explicitly injected", async () => {
    await expect(
      new OptInRealModelSmokeProvider().generateChangeSet({} as never)
    ).rejects.toThrow("opt_in_required")
  })

  it("rejects malformed model output before exposing it", async () => {
    const provider = new OptInRealModelSmokeProvider({
      request: async () => ({ baseRevision: "r1", operations: [] }),
    })
    await expect(
      provider.generateChangeSet({
        fixtureId: "starter",
        document: { version: 1, revision: "r1", nodes: [] },
        prompt: "x",
      })
    ).rejects.toThrow("empty_changeset")
  })

  it("rejects unknown model commands before exposing them", async () => {
    const provider = new OptInRealModelSmokeProvider({
      request: async () => ({
        id: "model",
        baseRevision: "r1",
        operations: [{ type: "RunScript", id: "title" }],
      }),
    })
    await expect(
      provider.generateChangeSet({
        fixtureId: "starter",
        document: { version: 1, revision: "r1", nodes: [] },
        prompt: "x",
      })
    ).rejects.toThrow("unknown_command")
  })

  it("rejects sensitive context before contacting the transport", async () => {
    let contacted = false
    const provider = new OptInRealModelSmokeProvider({
      request: async () => {
        contacted = true
        return {}
      },
    })
    await expect(
      provider.generateChangeSet({
        fixtureId: "starter",
        document: { version: 1, revision: "r1", nodes: [] },
        prompt: "x",
        context: { password: "do-not-send" },
      })
    ).rejects.toThrow("sensitive_context_rejected")
    expect(contacted).toBe(false)
  })
})

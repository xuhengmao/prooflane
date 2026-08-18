import { describe, expect, it } from "vitest"
import type { DesignDocument } from "../ast"
import { MockDesignAiProvider } from "./mock-provider"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  nodes: [{ id: "title", type: "text", text: "Before" }],
}

describe("MockDesignAiProvider", () => {
  it("returns deterministic ChangeSets without network access", async () => {
    const provider = new MockDesignAiProvider()
    const first = await provider.generateChangeSet({
      fixtureId: "starter",
      document,
      prompt: "After",
    })
    const second = await provider.generateChangeSet({
      fixtureId: "starter",
      document,
      prompt: "After",
    })
    expect(first).toEqual(second)
    expect(first.provider).toBe("deterministic-mock")
  })

  it("exposes fixed failure scenarios for guard tests", async () => {
    const provider = new MockDesignAiProvider()
    await expect(
      provider.generateChangeSet({
        fixtureId: "starter",
        document,
        prompt: "x",
        scenario: "failure",
      })
    ).rejects.toThrow("mock_provider_failure")
    const conflict = await provider.generateChangeSet({
      fixtureId: "starter",
      document,
      prompt: "x",
      scenario: "revision-conflict",
    })
    expect(conflict.baseRevision).toBe("stale-revision")
  })

  it("rejects sensitive context before generating a ChangeSet", async () => {
    const provider = new MockDesignAiProvider()
    await expect(
      provider.generateChangeSet({
        fixtureId: "starter",
        document,
        prompt: "x",
        context: "api_key=do-not-store",
      })
    ).rejects.toThrow("sensitive_context_rejected")
  })
})

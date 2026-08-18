import { describe, expect, it } from "vitest"
import { OptInRealModelSmokeProvider } from "./smoke-provider"

describe("real model smoke seam", () => {
  it("does not contact a model unless explicitly injected", async () => {
    await expect(
      new OptInRealModelSmokeProvider().generateChangeSet({} as never)
    ).rejects.toThrow("opt_in_required")
  })
})

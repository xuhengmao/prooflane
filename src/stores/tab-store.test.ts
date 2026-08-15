import { describe, expect, it } from "vitest"

import { useTabStore } from "./tab-store"

describe("tab-store new conversation ids", () => {
  it("returns the stable id of a newly created or reused chat draft", () => {
    const first = useTabStore.getState().openChatModeTab()
    expect(useTabStore.getState().rawTabs.some((tab) => tab.id === first)).toBe(
      true
    )

    const reused = useTabStore.getState().openChatModeTab()
    expect(reused).toBe(first)
  })
})

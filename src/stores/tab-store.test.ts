import { beforeEach, describe, expect, it } from "vitest"

import { resetTabStore, useTabStore } from "./tab-store"

describe("tab-store new conversation ids", () => {
  beforeEach(() => {
    localStorage.clear()
    resetTabStore()
  })

  it("returns the stable id of a newly created or reused project draft", () => {
    const first = useTabStore
      .getState()
      .openNewConversationTab(7, "C:/workspace/project")
    expect(useTabStore.getState().rawTabs).toContainEqual(
      expect.objectContaining({
        id: first,
        folderId: 7,
        conversationId: null,
        workingDir: "C:/workspace/project",
      })
    )

    const reused = useTabStore
      .getState()
      .openNewConversationTab(7, "C:/workspace/project")
    expect(reused).toBe(first)
  })

  it("returns the stable id of a newly created or reused chat draft", () => {
    const first = useTabStore.getState().openChatModeTab()
    expect(useTabStore.getState().rawTabs.some((tab) => tab.id === first)).toBe(
      true
    )

    const reused = useTabStore.getState().openChatModeTab()
    expect(reused).toBe(first)
  })
})

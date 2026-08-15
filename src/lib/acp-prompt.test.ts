import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  shellCall: vi.fn(),
  isDesktop: vi.fn(() => false),
  isRemoteDesktopMode: vi.fn(() => false),
  getActiveRemoteConnectionId: vi.fn<() => string | null>(() => null),
  notifyRemoteDesktopUnauthorized: vi.fn(),
}))

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
  getShellTransport: () => ({ call: mocks.shellCall }),
  isDesktop: mocks.isDesktop,
  isRemoteDesktopMode: mocks.isRemoteDesktopMode,
  getActiveRemoteConnectionId: mocks.getActiveRemoteConnectionId,
  notifyRemoteDesktopUnauthorized: mocks.notifyRemoteDesktopUnauthorized,
}))

import { acpPrompt } from "@/lib/api"

describe("acpPrompt relay transport contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.call.mockResolvedValue(undefined)
    mocks.isDesktop.mockReturnValue(false)
    mocks.getActiveRemoteConnectionId.mockReturnValue(null)
  })

  it("keeps the ordinary prompt payload and call shape unchanged", async () => {
    await acpPrompt(
      "connection-1",
      [{ type: "text", text: "hello" }],
      3,
      9,
      "message-1"
    )

    expect(mocks.call).toHaveBeenCalledWith("acp_prompt", {
      connectionId: "connection-1",
      blocks: [{ type: "text", text: "hello" }],
      folderId: 3,
      conversationId: 9,
      clientMessageId: "message-1",
    })
  })

  it("gives relay outcome finalization time to finish before web transport aborts", async () => {
    await acpPrompt(
      "connection-1",
      [{ type: "text", text: "continue" }],
      3,
      9,
      "message-1",
      7,
      "draft-1"
    )

    expect(mocks.call).toHaveBeenCalledWith(
      "acp_prompt",
      expect.objectContaining({ relayId: 7, targetDraftId: "draft-1" }),
      { timeoutMs: 50_000 }
    )
  })
})

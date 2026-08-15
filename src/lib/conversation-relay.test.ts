import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
}))

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
  getShellTransport: () => ({ call: vi.fn() }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
  notifyRemoteDesktopUnauthorized: vi.fn(),
}))

import {
  getConversationCapabilities,
  getConversationRelay,
  getRelayContextByDraft,
  previewRelayContext,
  removeRelayContext,
  updateConversationCapabilities,
  updateRelayContext,
} from "@/lib/api"
import type {
  RelayContextPack,
  RelayPatchInput,
  RelayPreviewInput,
} from "@/lib/types"

const scope = {
  scopeType: "recent_rounds" as const,
  selectedRoundIds: ["round-1"],
}

const pack: RelayContextPack = {
  id: 7,
  targetDraftId: "new-tab-7",
  targetConversationId: null,
  sourceConversationId: 42,
  sourceFolderId: 3,
  scope,
  snapshot: {
    version: 1,
    source: { conversationId: 42, folderId: 3 },
    scope,
    availableRounds: [],
    includedRounds: [],
    summary: null,
    files: [],
    stats: { messageCount: 0, fileCount: 0, todoCount: 0 },
    canonicalContext: "context",
  },
  sourceFingerprint: "fingerprint",
  estimatedTokens: 12,
  contextWindowTokens: 200000,
  allowedTokens: 12000,
  status: "draft",
  invalidReason: null,
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  consumedAt: null,
}

describe("conversation relay transport API", () => {
  beforeEach(() => {
    mocks.call.mockReset()
    mocks.call.mockResolvedValue(pack)
  })

  it("reads and updates the relay capability with camelCase wire fields", async () => {
    mocks.call
      .mockResolvedValueOnce({ relayEnabled: true })
      .mockResolvedValueOnce({ relayEnabled: false })

    await getConversationCapabilities()
    await updateConversationCapabilities({ relayEnabled: false })

    expect(mocks.call.mock.calls).toEqual([
      ["get_conversation_capabilities"],
      ["update_conversation_capabilities", { relayEnabled: false }],
    ])
  })

  it("previews an explicitly selected cross-project source", async () => {
    const input: RelayPreviewInput = {
      targetDraftId: "new-tab-7",
      sourceConversationId: 42,
      targetFolderId: 9,
      targetAgentType: "codex",
      targetModel: "gpt-5.4",
      scope,
    }

    await previewRelayContext(input)

    expect(mocks.call).toHaveBeenCalledWith("preview_relay_context", input)
  })

  it("restores a relay by stable draft id", async () => {
    await getRelayContextByDraft("new-tab-7")

    expect(mocks.call).toHaveBeenCalledWith("get_relay_context_by_draft", {
      targetDraftId: "new-tab-7",
    })
  })

  it("patches the scope and backend-derived model selection", async () => {
    const input: RelayPatchInput = {
      scope,
      targetAgentType: "codex",
      targetModel: "gpt-5.4",
    }

    await updateRelayContext(7, input)

    expect(mocks.call).toHaveBeenCalledWith("update_relay_context", {
      relayId: 7,
      input,
    })
  })

  it("soft-removes a relay by id", async () => {
    await removeRelayContext(7)

    expect(mocks.call).toHaveBeenCalledWith("remove_relay_context", {
      relayId: 7,
    })
  })

  it("reads consumed relay provenance by target conversation", async () => {
    mocks.call.mockResolvedValueOnce(null)

    await getConversationRelay(99)

    expect(mocks.call).toHaveBeenCalledWith("get_conversation_relay", {
      conversationId: 99,
    })
  })
})

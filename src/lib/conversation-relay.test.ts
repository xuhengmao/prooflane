import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  randomUUID: vi.fn(),
}))

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
  getShellTransport: () => ({ call: vi.fn() }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
  notifyRemoteDesktopUnauthorized: vi.fn(),
}))

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  randomUUID: mocks.randomUUID,
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
import {
  consumeRelayIntent,
  hasRelayDragType,
  RELAY_DRAG_MIME,
  queueRelayIntent,
  readRelayDragData,
  subscribeRelayIntent,
  writeRelayDragData,
} from "@/lib/conversation-relay"
import * as conversationRelay from "@/lib/conversation-relay"
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
  targetModel: null,
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
    mocks.randomUUID.mockReset()
    mocks.randomUUID.mockReturnValue("relay-preview-request-id")
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

  it("uses a dedicated MIME type and consumes handoff intents once", () => {
    const setData = vi.fn()
    writeRelayDragData({ setData } as unknown as DataTransfer, {
      conversationId: 42,
      folderId: 3,
    })
    expect(setData).toHaveBeenCalledWith(
      RELAY_DRAG_MIME,
      JSON.stringify({ conversationId: 42, folderId: 3 })
    )
    expect(
      readRelayDragData({
        types: [RELAY_DRAG_MIME],
        getData: () => JSON.stringify({ conversationId: 42, folderId: 3 }),
      })
    ).toEqual({ conversationId: 42, folderId: 3 })
    expect(hasRelayDragType({ types: [RELAY_DRAG_MIME] })).toBe(true)
    expect(hasRelayDragType({ types: ["Files"] })).toBe(false)

    queueRelayIntent({ tabId: "draft-42", sourceConversationId: 42 })
    expect(consumeRelayIntent("draft-42")).toEqual({
      tabId: "draft-42",
      sourceConversationId: 42,
    })
    expect(consumeRelayIntent("draft-42")).toBeNull()
  })

  it("prefers the latest source folder and falls back to the sidebar row", () => {
    const resolveSourceFolderId = (
      conversationRelay as typeof conversationRelay & {
        resolveRelaySourceFolderId?: (
          sourceConversationId: number,
          fallbackFolderId: number,
          conversations: Array<{ id: number; folder_id: number }>
        ) => number
      }
    ).resolveRelaySourceFolderId

    expect(resolveSourceFolderId?.(42, 3, [{ id: 42, folder_id: 9 }])).toBe(9)
    expect(resolveSourceFolderId?.(42, 3, [{ id: 71, folder_id: 8 }])).toBe(3)
  })

  it("notifies an already-mounted draft when an intent is queued", () => {
    const observed: unknown[] = []
    const unsubscribe = subscribeRelayIntent("mounted-draft", () => {
      observed.push(consumeRelayIntent("mounted-draft"))
    })

    queueRelayIntent({
      tabId: "mounted-draft",
      sourceConversationId: 71,
    })

    expect(observed).toEqual([
      { tabId: "mounted-draft", sourceConversationId: 71 },
    ])
    expect(consumeRelayIntent("mounted-draft")).toBeNull()

    unsubscribe()
    queueRelayIntent({
      tabId: "mounted-draft",
      sourceConversationId: 72,
    })
    expect(observed).toHaveLength(1)
    expect(consumeRelayIntent("mounted-draft")?.sourceConversationId).toBe(72)
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

    expect(mocks.call.mock.calls).toEqual([
      [
        "reserve_relay_preview",
        {
          requestId: "relay-preview-request-id",
          targetDraftId: "new-tab-7",
        },
      ],
      [
        "preview_relay_context",
        {
          ...input,
          requestId: "relay-preview-request-id",
        },
        { timeoutMs: 60 * 60_000 },
      ],
    ])
  })

  it("cleans a reservation cancelled before preview starts", async () => {
    const input: RelayPreviewInput = {
      targetDraftId: "new-tab-reserve-abort",
      sourceConversationId: 42,
      targetFolderId: 9,
      targetAgentType: "codex",
      targetModel: "gpt-5.4",
      scope,
    }
    let resolveReservation: (value: boolean) => void = () => {}
    const reservation = new Promise<boolean>((resolve) => {
      resolveReservation = resolve
    })
    mocks.call.mockImplementation((command: string) =>
      command === "reserve_relay_preview" ? reservation : Promise.resolve(true)
    )
    const controller = new AbortController()

    const result = previewRelayContext(input, controller.signal)
    controller.abort()

    const outcome = result.then(
      () => "resolved",
      (error: Error) => error.name
    )
    await expect(
      Promise.race([
        outcome,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("still-pending"), 0)
        ),
      ])
    ).resolves.toBe("AbortError")
    expect(mocks.call.mock.calls).toEqual([
      [
        "reserve_relay_preview",
        {
          requestId: "relay-preview-request-id",
          targetDraftId: "new-tab-reserve-abort",
        },
      ],
    ])

    resolveReservation(true)
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(mocks.call.mock.calls).toEqual([
      [
        "reserve_relay_preview",
        {
          requestId: "relay-preview-request-id",
          targetDraftId: "new-tab-reserve-abort",
        },
      ],
      ["cancel_relay_preview", { requestId: "relay-preview-request-id" }],
    ])
  })

  it("cancels an aborted preview with the exact internal request id", async () => {
    const input: RelayPreviewInput = {
      targetDraftId: "new-tab-abort",
      sourceConversationId: 42,
      targetFolderId: 9,
      targetAgentType: "codex",
      targetModel: "gpt-5.4",
      scope,
    }
    const pending = new Promise<RelayContextPack>(() => {})
    mocks.call.mockImplementation((command: string) => {
      if (command === "reserve_relay_preview") return Promise.resolve(true)
      if (command === "cancel_relay_preview") return Promise.resolve(true)
      return pending
    })
    const controller = new AbortController()

    const result = previewRelayContext(input, controller.signal)
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    await vi.waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(3))
    const previewArgs = mocks.call.mock.calls[1][1]
    expect(previewArgs).toEqual({
      ...input,
      requestId: "relay-preview-request-id",
    })
    expect(mocks.call.mock.calls[0]).toEqual([
      "reserve_relay_preview",
      {
        requestId: "relay-preview-request-id",
        targetDraftId: "new-tab-abort",
      },
    ])
    expect(mocks.call.mock.calls[2]).toEqual([
      "cancel_relay_preview",
      { requestId: previewArgs.requestId },
    ])
  })

  it("cancels the same request id when the transport fails", async () => {
    const input: RelayPreviewInput = {
      targetDraftId: "new-tab-timeout",
      sourceConversationId: 42,
      targetFolderId: 9,
      targetAgentType: "codex",
      targetModel: "gpt-5.4",
      scope,
    }
    mocks.call
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce(true)

    await expect(previewRelayContext(input)).rejects.toThrow(
      "Request timed out"
    )

    expect(mocks.call.mock.calls).toEqual([
      [
        "reserve_relay_preview",
        {
          requestId: "relay-preview-request-id",
          targetDraftId: "new-tab-timeout",
        },
      ],
      [
        "preview_relay_context",
        { ...input, requestId: "relay-preview-request-id" },
        { timeoutMs: 60 * 60_000 },
      ],
      ["cancel_relay_preview", { requestId: "relay-preview-request-id" }],
    ])
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

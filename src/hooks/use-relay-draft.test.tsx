import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { RelayContextPack } from "@/lib/types"

const pack: RelayContextPack = {
  id: 7,
  targetDraftId: "draft-1",
  targetConversationId: null,
  sourceConversationId: 44,
  sourceFolderId: 2,
  scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
  snapshot: {
    version: 1,
    source: { conversationId: 44, folderId: 2 },
    scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
    availableRounds: [],
    includedRounds: [],
    summary: null,
    files: [],
    stats: { messageCount: 1, fileCount: 0, todoCount: 0 },
    canonicalContext: "context",
  },
  sourceFingerprint: "fingerprint",
  estimatedTokens: 10,
  contextWindowTokens: 200000,
  allowedTokens: 12000,
  status: "draft",
  invalidReason: null,
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  consumedAt: null,
}

vi.mock("@/lib/conversation-relay", () => ({
  getRelayContextByDraft: vi.fn(),
  previewRelayContext: vi.fn(),
  updateRelayContext: vi.fn(),
  removeRelayContext: vi.fn(),
}))

let capabilityHandler: ((settings: { relayEnabled: boolean }) => void) | null =
  null
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(
    async (
      event: string,
      handler: (value: { relayEnabled: boolean }) => void
    ) => {
      if (event === "conversation-capabilities://changed")
        capabilityHandler = handler
      return () => {}
    }
  ),
  onTransportReconnect: vi.fn(() => () => {}),
}))

beforeEach(() => {
  vi.resetModules()
  capabilityHandler = null
})

async function setup() {
  const api = await import("@/lib/conversation-relay")
  vi.mocked(api.getRelayContextByDraft).mockResolvedValue(null)
  vi.mocked(api.previewRelayContext).mockResolvedValue(pack)
  vi.mocked(api.updateRelayContext).mockResolvedValue(pack)
  vi.mocked(api.removeRelayContext).mockResolvedValue({
    ...pack,
    status: "removed",
  })
  const hook = await import("./use-relay-draft")
  return { api, ...hook }
}

describe("useRelayDraft", () => {
  it("does not request relay history for an untouched new conversation", async () => {
    const { api, useRelayDraft } = await setup()
    renderHook(() =>
      useRelayDraft({
        targetDraftId: "draft-1",
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: null,
        enabled: true,
      })
    )

    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())
    expect(api.previewRelayContext).not.toHaveBeenCalled()
  })

  it("restores the existing draft pack without listing conversation history", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() =>
      useRelayDraft({
        targetDraftId: "draft-1",
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: null,
        enabled: true,
      })
    )

    await waitFor(() => expect(result.current.relay).toEqual(pack))
    expect(api.previewRelayContext).not.toHaveBeenCalled()
  })

  it("recalculates an existing pack when the target model changes", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { rerender } = renderHook(
      ({ targetModel }: { targetModel: string | null }) =>
        useRelayDraft({
          targetDraftId: "draft-1",
          targetFolderId: 1,
          targetAgentType: "codex",
          targetModel,
          enabled: true,
        }),
      { initialProps: { targetModel: null as string | null } }
    )
    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())

    rerender({ targetModel: "gpt-5.4" })
    await waitFor(() =>
      expect(api.updateRelayContext).toHaveBeenCalledWith(7, {
        scope: pack.scope,
        targetAgentType: "codex",
        targetModel: "gpt-5.4",
      })
    )
  })

  it("keeps the existing pack and marks its stable reason when a model recalculation exceeds budget", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    vi.mocked(api.updateRelayContext).mockRejectedValue(
      new Error(
        JSON.stringify({
          code: "relay_budget_exceeded",
          message: "relay_budget_exceeded",
          detail: null,
          i18n_key: null,
          i18n_params: null,
        })
      )
    )
    const { result, rerender } = renderHook(
      ({ targetModel }: { targetModel: string | null }) =>
        useRelayDraft({
          targetDraftId: "draft-1",
          targetFolderId: 1,
          targetAgentType: "codex",
          targetModel,
          enabled: true,
        }),
      { initialProps: { targetModel: null as string | null } }
    )
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    rerender({ targetModel: "too-small" })
    await waitFor(() =>
      expect(result.current.relay?.invalidReason).toBe("relay_budget_exceeded")
    )
    expect(result.current.relay?.estimatedTokens).toBe(10)
    expect(result.current.relay?.allowedTokens).toBe(12000)
  })

  it("clears the relay view when another window disables the capability", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() =>
      useRelayDraft({
        targetDraftId: "draft-1",
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: null,
        enabled: true,
      })
    )
    await waitFor(() => expect(result.current.relay).toEqual(pack))
    await waitFor(() => expect(capabilityHandler).not.toBeNull())

    act(() => capabilityHandler?.({ relayEnabled: false }))
    expect(result.current.relay).toBeNull()
  })

  it("undoes removal by previewing a new active pack instead of restoring the removed row", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() =>
      useRelayDraft({
        targetDraftId: "draft-1",
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: "gpt-5.4",
        enabled: true,
      })
    )
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    await act(async () => {
      await result.current.remove()
      await result.current.undoRemove()
    })

    expect(api.previewRelayContext).toHaveBeenLastCalledWith(
      {
        targetDraftId: "draft-1",
        sourceConversationId: 44,
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: "gpt-5.4",
        scope: pack.scope,
      },
      expect.any(AbortSignal)
    )
  })
})

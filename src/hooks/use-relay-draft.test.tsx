import { StrictMode, type ReactNode } from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationRelayChange, RelayContextPack } from "@/lib/types"

function makePack(overrides: Partial<RelayContextPack> = {}): RelayContextPack {
  const sourceConversationId = overrides.sourceConversationId ?? 44
  const sourceFolderId = overrides.sourceFolderId ?? 2
  const scope = overrides.scope ?? {
    scopeType: "recent_rounds" as const,
    selectedRoundIds: ["round-1"],
  }
  return {
    id: 7,
    targetDraftId: "draft-1",
    targetConversationId: null,
    sourceConversationId,
    sourceFolderId,
    scope,
    snapshot: {
      version: 1,
      source: {
        conversationId: sourceConversationId,
        folderId: sourceFolderId,
      },
      scope,
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
    targetModel: null,
    allowedTokens: 12000,
    status: "draft",
    invalidReason: null,
    createdAt: "2026-08-15T00:00:00Z",
    updatedAt: "2026-08-15T00:00:00Z",
    consumedAt: null,
    ...overrides,
  }
}

const pack = makePack()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock("@/lib/conversation-relay", () => ({
  getRelayContextByDraft: vi.fn(),
  previewRelayContext: vi.fn(),
  updateRelayContext: vi.fn(),
  removeRelayContext: vi.fn(),
}))

type EventHandler = (value: unknown) => void
const eventHandlers = new Map<string, Set<EventHandler>>()
const reconnectHandlers = new Set<() => void>()
let subscriptionGate: Promise<void> | null = null
const unsubscribeCalls = vi.fn()
const offReconnectCalls = vi.fn()

vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn((event: string, handler: EventHandler) => {
    const handlers = eventHandlers.get(event) ?? new Set<EventHandler>()
    handlers.add(handler)
    eventHandlers.set(event, handlers)
    return (subscriptionGate ?? Promise.resolve()).then(() => () => {
      handlers.delete(handler)
      unsubscribeCalls(event)
    })
  }),
  onTransportReconnect: vi.fn((handler: () => void) => {
    reconnectHandlers.add(handler)
    return () => {
      reconnectHandlers.delete(handler)
      offReconnectCalls()
    }
  }),
}))

function emit(event: string, value: unknown) {
  for (const handler of [...(eventHandlers.get(event) ?? [])]) handler(value)
}

function emitCapabilities(relayEnabled: boolean) {
  emit("conversation-capabilities://changed", { relayEnabled })
}

function emitRelay(change: ConversationRelayChange) {
  emit("conversation-relay://changed", change)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  eventHandlers.clear()
  reconnectHandlers.clear()
  subscriptionGate = null
})

afterEach(() => {
  vi.useRealTimers()
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

const defaultOptions = {
  targetDraftId: "draft-1",
  targetFolderId: 1 as number | null,
  targetAgentType: "codex" as const,
  targetModel: null as string | null,
  enabled: true,
  sendPending: false,
}

describe("useRelayDraft", () => {
  it("does not request relay history for an untouched new conversation", async () => {
    const { api, useRelayDraft } = await setup()
    renderHook(() => useRelayDraft(defaultOptions))

    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())
    expect(api.previewRelayContext).not.toHaveBeenCalled()
  })

  it("waits for both event subscriptions before restoring the draft", async () => {
    const { api, useRelayDraft } = await setup()
    const ready = deferred<void>()
    subscriptionGate = ready.promise

    renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() =>
      expect(eventHandlers.get("conversation-relay://changed")?.size).toBe(1)
    )
    expect(api.getRelayContextByDraft).not.toHaveBeenCalled()

    ready.resolve()
    await waitFor(() =>
      expect(api.getRelayContextByDraft).toHaveBeenCalledOnce()
    )
  })

  it("does not cancel an explicit preview when delayed subscriptions become ready", async () => {
    const { api, useRelayDraft } = await setup()
    const ready = deferred<void>()
    const previewResult = deferred<RelayContextPack>()
    let previewSignal: AbortSignal | undefined
    subscriptionGate = ready.promise
    vi.mocked(api.previewRelayContext).mockImplementation((_input, signal) => {
      previewSignal = signal
      return previewResult.promise
    })
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() =>
      expect(eventHandlers.get("conversation-relay://changed")?.size).toBe(1)
    )

    let previewPromise!: Promise<void>
    act(() => {
      previewPromise = result.current.preview(44)
    })
    await waitFor(() => expect(previewSignal).toBeDefined())
    ready.resolve()
    await act(async () => ready.promise)

    expect(previewSignal?.aborted).toBe(false)
    expect(api.getRelayContextByDraft).not.toHaveBeenCalled()

    previewResult.resolve(pack)
    await act(async () => previewPromise)
    expect(result.current.relay).toEqual(pack)
  })

  it("restores the existing draft pack without listing conversation history", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))

    await waitFor(() => expect(result.current.relay).toEqual(pack))
    expect(api.previewRelayContext).not.toHaveBeenCalled()
  })

  it("restores and follows events by bound conversation id after restart", async () => {
    const { api, useRelayDraft } = await setup()
    const attached = makePack({
      status: "attached",
      targetDraftId: "new-original-tab",
      targetConversationId: 91,
    })
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(attached)
    const { result } = renderHook(() =>
      useRelayDraft({
        ...defaultOptions,
        targetDraftId: "conv-91",
        targetConversationId: 91,
      })
    )

    await waitFor(() => expect(result.current.relay).toEqual(attached))
    expect(api.getRelayContextByDraft).toHaveBeenCalledWith("conv-91", 91)

    act(() =>
      emitRelay({
        relayId: attached.id,
        targetDraftId: "new-original-tab",
        targetConversationId: 91,
        status: "invalid",
        errorCode: "relay_send_uncertain",
      })
    )

    expect(result.current.relay?.status).toBe("invalid")
    expect(result.current.relay?.invalidReason).toBe("relay_send_uncertain")
  })

  it("keeps the current relay available to settle a failure while its claim is hidden", async () => {
    const { api, useRelayDraft } = await setup()
    const hiddenClaim = deferred<RelayContextPack | null>()
    vi.mocked(api.getRelayContextByDraft)
      .mockResolvedValueOnce(pack)
      .mockReturnValueOnce(hiddenClaim.promise)
    const { result, rerender } = renderHook(
      ({ targetConversationId, sendPending }) =>
        useRelayDraft({
          ...defaultOptions,
          targetConversationId,
          sendPending,
        }),
      {
        initialProps: {
          targetConversationId: null as number | null,
          sendPending: false,
        },
      }
    )
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    rerender({ targetConversationId: 91, sendPending: true })
    await waitFor(() =>
      expect(api.getRelayContextByDraft).toHaveBeenCalledTimes(2)
    )

    act(() => result.current.markSendFailure("relay_model_changed"))
    expect(result.current.relay).toEqual({
      ...pack,
      status: "invalid",
      invalidReason: "relay_model_changed",
    })

    await act(async () => {
      hiddenClaim.resolve(null)
      await hiddenClaim.promise
    })
    expect(result.current.relay).toEqual({
      ...pack,
      status: "invalid",
      invalidReason: "relay_model_changed",
    })
  })

  it("refreshes a restored bound pack with its persisted draft id", async () => {
    const { api, useRelayDraft } = await setup()
    const attached = makePack({
      status: "attached",
      targetDraftId: "new-original-tab",
      targetConversationId: 91,
    })
    const refreshed = makePack({
      id: 8,
      status: "attached",
      targetDraftId: "new-original-tab",
      targetConversationId: 91,
    })
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(attached)
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { result } = renderHook(() =>
      useRelayDraft({
        ...defaultOptions,
        targetDraftId: "conv-91",
        targetConversationId: 91,
      })
    )
    await waitFor(() => expect(result.current.relay).toEqual(attached))

    await act(async () => result.current.refresh())

    expect(api.previewRelayContext).toHaveBeenCalledWith(
      expect.objectContaining({ targetDraftId: "new-original-tab" }),
      expect.any(AbortSignal)
    )
    expect(result.current.relay).toEqual(refreshed)
  })

  it("updates a restored bound pack scope with its persisted draft id", async () => {
    const { api, useRelayDraft } = await setup()
    const attached = makePack({
      status: "attached",
      targetDraftId: "new-original-tab",
      targetConversationId: 91,
    })
    const scope = {
      scopeType: "custom_rounds" as const,
      selectedRoundIds: ["round-2"],
    }
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(attached)
    vi.mocked(api.previewRelayContext).mockResolvedValue(
      makePack({
        id: 8,
        status: "attached",
        targetDraftId: "new-original-tab",
        targetConversationId: 91,
        scope,
      })
    )
    const { result } = renderHook(() =>
      useRelayDraft({
        ...defaultOptions,
        targetDraftId: "conv-91",
        targetConversationId: 91,
      })
    )
    await waitFor(() => expect(result.current.relay).toEqual(attached))

    await act(async () => result.current.updateScope(scope))

    expect(api.previewRelayContext).toHaveBeenCalledWith(
      expect.objectContaining({ targetDraftId: "new-original-tab", scope }),
      expect.any(AbortSignal)
    )
  })

  it("keeps an initial recovery failure visible and retryable until no pack is confirmed", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft)
      .mockRejectedValueOnce(new Error("relay context unavailable"))
      .mockResolvedValueOnce(null)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))

    await waitFor(() => expect(result.current.recoveryError).toBe(true))
    expect(result.current.loading).toBe(false)

    await act(async () => result.current.retry())

    expect(result.current.recoveryError).toBe(false)
    expect(result.current.relay).toBeNull()
  })

  it("restores correctly under React StrictMode effect replay", async () => {
    const { api, useRelayDraft } = await setup()
    const recovery = deferred<RelayContextPack | null>()
    vi.mocked(api.getRelayContextByDraft).mockReturnValue(recovery.promise)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    )

    const { result } = renderHook(() => useRelayDraft(defaultOptions), {
      wrapper,
    })

    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())
    recovery.resolve(pack)
    await waitFor(() => expect(result.current.relay).toEqual(pack))
    expect(result.current.loading).toBe(false)
  })

  it("disposes subscriptions that resolve after unmount without restoring", async () => {
    const { api, useRelayDraft } = await setup()
    const ready = deferred<void>()
    subscriptionGate = ready.promise
    const view = renderHook(() => useRelayDraft(defaultOptions))

    await waitFor(() =>
      expect(eventHandlers.get("conversation-relay://changed")?.size).toBe(1)
    )
    view.unmount()
    ready.resolve()

    await waitFor(() => expect(unsubscribeCalls).toHaveBeenCalledTimes(2))
    expect(eventHandlers.get("conversation-relay://changed")?.size ?? 0).toBe(0)
    expect(
      eventHandlers.get("conversation-capabilities://changed")?.size ?? 0
    ).toBe(0)
    expect(api.getRelayContextByDraft).not.toHaveBeenCalled()
  })

  it("ignores a draft recovery that resolves after unmount", async () => {
    const { api, useRelayDraft } = await setup()
    const recovery = deferred<RelayContextPack | null>()
    vi.mocked(api.getRelayContextByDraft).mockReturnValue(recovery.promise)
    const view = renderHook(() => useRelayDraft(defaultOptions))

    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())
    expect(view.result.current.loading).toBe(true)
    view.unmount()

    await act(async () => {
      recovery.resolve(pack)
      await recovery.promise
    })

    expect(view.result.current.relay).toBeNull()
  })

  it("recalculates an existing pack when the target model changes", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const refreshed = makePack({ id: 8, targetModel: "gpt-5.4" })
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { rerender } = renderHook(
      ({ targetModel }: { targetModel: string | null }) =>
        useRelayDraft({ ...defaultOptions, targetModel }),
      { initialProps: { targetModel: null as string | null } }
    )
    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())

    rerender({ targetModel: "gpt-5.4" })
    await waitFor(() =>
      expect(api.previewRelayContext).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDraftId: "draft-1",
          sourceConversationId: pack.sourceConversationId,
          targetModel: "gpt-5.4",
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
        }),
        expect.any(AbortSignal)
      )
    )
    expect(api.updateRelayContext).not.toHaveBeenCalled()
  })

  it("recalculates after a model change that happens during draft recovery", async () => {
    const { api, useRelayDraft } = await setup()
    const recovery = deferred<RelayContextPack | null>()
    vi.mocked(api.getRelayContextByDraft).mockReturnValue(recovery.promise)
    vi.mocked(api.previewRelayContext).mockResolvedValue(
      makePack({ id: 8, targetModel: "gpt-5.4" })
    )
    const { rerender } = renderHook(
      ({ targetModel }: { targetModel: string | null }) =>
        useRelayDraft({ ...defaultOptions, targetModel }),
      { initialProps: { targetModel: null as string | null } }
    )
    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())

    rerender({ targetModel: "gpt-5.4" })
    recovery.resolve(pack)

    await waitFor(() =>
      expect(api.previewRelayContext).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceConversationId: pack.sourceConversationId,
          targetModel: "gpt-5.4",
        }),
        expect.any(AbortSignal)
      )
    )
    expect(api.updateRelayContext).not.toHaveBeenCalled()
  })

  it("recalculates a restored pack whose persisted model differs", async () => {
    const { api, useRelayDraft } = await setup()
    const stale = makePack({ targetModel: "gpt-4o" })
    const refreshed = makePack({ id: 8, targetModel: "gpt-5.4" })
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(stale)
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { result } = renderHook(() =>
      useRelayDraft({ ...defaultOptions, targetModel: "gpt-5.4" })
    )

    await waitFor(() => expect(result.current.relay).toEqual(refreshed))
    expect(api.previewRelayContext).toHaveBeenCalledWith(
      expect.objectContaining({ targetModel: "gpt-5.4" }),
      expect.any(AbortSignal)
    )
    expect(api.updateRelayContext).not.toHaveBeenCalled()
  })

  it("recognizes the real invalid_input envelope and marks a budget failure", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    vi.mocked(api.previewRelayContext).mockRejectedValue(
      new Error(
        JSON.stringify({
          code: "invalid_input",
          message: "relay_budget_exceeded",
          detail: null,
          i18n_key: null,
          i18n_params: null,
        })
      )
    )
    const { result, rerender } = renderHook(
      ({ targetModel }: { targetModel: string | null }) =>
        useRelayDraft({ ...defaultOptions, targetModel }),
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

  it("reloads the current pack after a scope update loses a CAS race", async () => {
    const { api, useRelayDraft } = await setup()
    const requestedScope = {
      scopeType: "custom_rounds" as const,
      selectedRoundIds: ["round-2"],
    }
    const replacement = makePack({
      id: 8,
      scope: {
        scopeType: "custom_rounds",
        selectedRoundIds: ["round-3"],
      },
    })
    let loadCount = 0
    vi.mocked(api.getRelayContextByDraft).mockImplementation(async () => {
      loadCount += 1
      return loadCount === 1 ? pack : replacement
    })
    vi.mocked(api.updateRelayContext).mockRejectedValue(
      new Error(
        JSON.stringify({
          code: "invalid_input",
          message: "relay_consume_conflict",
          detail: null,
          i18n_key: null,
          i18n_params: null,
        })
      )
    )
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    await act(async () => {
      await expect(result.current.updateScope(requestedScope)).rejects.toThrow(
        "relay_consume_conflict"
      )
    })

    expect(api.getRelayContextByDraft).toHaveBeenCalledTimes(2)
    expect(result.current.relay).toEqual(replacement)
  })

  it("updates an attached scope through a replacement preview", async () => {
    const { api, useRelayDraft } = await setup()
    const attached = makePack({
      status: "attached",
      targetConversationId: 91,
    })
    const scope = {
      scopeType: "custom_rounds" as const,
      selectedRoundIds: ["round-2"],
    }
    const refreshed = makePack({
      id: 8,
      status: "attached",
      targetConversationId: 91,
      scope,
    })
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(attached)
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(attached))

    await act(async () => result.current.updateScope(scope))

    expect(api.previewRelayContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceConversationId: attached.sourceConversationId,
        scope,
      }),
      expect.any(AbortSignal)
    )
    expect(api.updateRelayContext).not.toHaveBeenCalled()
    expect(result.current.relay).toEqual(refreshed)
  })

  it("keeps an uncertain send invalid until the user refreshes it", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const refreshed = makePack({ id: 8, status: "attached" })
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    act(() =>
      emitRelay({
        relayId: pack.id,
        targetDraftId: "draft-1",
        status: "invalid",
        errorCode: "relay_send_uncertain",
      })
    )

    expect(result.current.relay?.status).toBe("invalid")
    expect(result.current.relay?.invalidReason).toBe("relay_send_uncertain")
    expect(api.previewRelayContext).not.toHaveBeenCalled()

    await act(async () => result.current.refresh())
    expect(result.current.relay).toEqual(refreshed)
  })

  it("preserves a rounds-changed event on the current relay", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    act(() =>
      emitRelay({
        relayId: pack.id,
        targetDraftId: "draft-1",
        status: "draft",
        errorCode: "relay_rounds_changed",
      })
    )

    await waitFor(() =>
      expect(result.current.relay?.invalidReason).toBe("relay_rounds_changed")
    )
    expect(result.current.relay?.snapshot).toBe(pack.snapshot)
  })

  it("marks a direct send failure and refreshes it with a new preview", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const refreshed = makePack({
      id: 8,
      sourceFingerprint: "refreshed-fingerprint",
      invalidReason: null,
    })
    vi.mocked(api.previewRelayContext).mockResolvedValue(refreshed)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    const relayActions = result.current as typeof result.current & {
      markSendFailure?: (error: unknown) => void
      refresh?: () => Promise<void>
    }
    expect(relayActions.markSendFailure).toBeTypeOf("function")
    act(() =>
      relayActions.markSendFailure?.(
        new Error(
          JSON.stringify({
            code: "invalid_input",
            message: "relay_rounds_changed",
          })
        )
      )
    )
    expect(result.current.relay?.invalidReason).toBe("relay_rounds_changed")

    expect(relayActions.refresh).toBeTypeOf("function")
    await act(async () => relayActions.refresh?.())
    expect(api.previewRelayContext).toHaveBeenLastCalledWith(
      {
        targetDraftId: "draft-1",
        sourceConversationId: 44,
        targetFolderId: 1,
        targetAgentType: "codex",
        targetModel: null,
        scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
      },
      expect.any(AbortSignal)
    )
    expect(result.current.relay).toEqual(refreshed)
  })

  it("keeps explicit custom round ids when refreshing", async () => {
    const { api, useRelayDraft } = await setup()
    const custom = makePack({
      scope: {
        scopeType: "custom_rounds",
        selectedRoundIds: ["round-2", "round-4"],
      },
    })
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(custom)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(custom))

    await act(async () => result.current.refresh())

    expect(api.previewRelayContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: custom.scope }),
      expect.any(AbortSignal)
    )
  })

  it("clears the relay view when another window disables the capability", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    act(() => emitCapabilities(false))
    expect(result.current.relay).toBeNull()
  })

  it("aborts an older preview when the scope is updated", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const pendingPreview = deferred<RelayContextPack>()
    let previewSignal: AbortSignal | undefined
    vi.mocked(api.previewRelayContext).mockImplementation((_input, signal) => {
      previewSignal = signal
      return pendingPreview.promise
    })
    const updated = makePack({
      scope: { scopeType: "custom_rounds", selectedRoundIds: ["round-2"] },
    })
    vi.mocked(api.updateRelayContext).mockResolvedValue(updated)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    let previewPromise!: Promise<void>
    act(() => {
      previewPromise = result.current.preview(55)
    })
    await waitFor(() => expect(previewSignal).toBeDefined())

    await act(async () => {
      await result.current.updateScope(updated.scope)
    })
    expect(previewSignal?.aborted).toBe(true)

    pendingPreview.resolve(makePack({ sourceConversationId: 55 }))
    await act(async () => previewPromise)
    expect(result.current.relay).toEqual(updated)
  })

  it("aborts an in-flight preview when the draft relay is cleared", async () => {
    const { api, useRelayDraft } = await setup()
    const pendingPreview = deferred<RelayContextPack>()
    let previewSignal: AbortSignal | undefined
    vi.mocked(api.previewRelayContext).mockImplementation((_input, signal) => {
      previewSignal = signal
      return pendingPreview.promise
    })
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let previewPromise!: Promise<void>
    act(() => {
      previewPromise = result.current.preview(44)
    })
    await waitFor(() => expect(previewSignal).toBeDefined())

    act(() => result.current.clear())
    expect(previewSignal?.aborted).toBe(true)
    pendingPreview.resolve(pack)
    await act(async () => previewPromise)
    expect(result.current.relay).toBeNull()
  })

  it("does not let a late remove from the old draft overwrite a new draft", async () => {
    const { api, useRelayDraft } = await setup()
    const packB = makePack({ id: 8, targetDraftId: "draft-2" })
    vi.mocked(api.getRelayContextByDraft).mockImplementation((draftId) =>
      Promise.resolve(draftId === "draft-1" ? pack : packB)
    )
    const removal = deferred<RelayContextPack>()
    vi.mocked(api.removeRelayContext).mockReturnValue(removal.promise)
    const { result, rerender } = renderHook(
      ({ targetDraftId }: { targetDraftId: string }) =>
        useRelayDraft({ ...defaultOptions, targetDraftId }),
      { initialProps: { targetDraftId: "draft-1" } }
    )
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    let removePromise!: Promise<void>
    act(() => {
      removePromise = result.current.remove()
    })
    rerender({ targetDraftId: "draft-2" })
    await waitFor(() => expect(result.current.relay).toEqual(packB))

    removal.resolve({ ...pack, status: "removed" })
    await act(async () => removePromise)
    expect(result.current.relay).toEqual(packB)
  })

  it("keeps the undo pack when the local remove event arrives before or after the response", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft)
      .mockResolvedValueOnce(pack)
      .mockResolvedValue(null)
    const removal = deferred<RelayContextPack>()
    vi.mocked(api.removeRelayContext).mockReturnValue(removal.promise)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    let removePromise!: Promise<void>
    act(() => {
      removePromise = result.current.remove()
    })
    act(() =>
      emitRelay({
        relayId: pack.id,
        targetDraftId: "draft-1",
        status: "removed",
      })
    )
    removal.resolve({ ...pack, status: "removed" })
    await act(async () => removePromise)
    expect(result.current.relay?.status).toBe("removed")

    act(() =>
      emitRelay({
        relayId: pack.id,
        targetDraftId: "draft-1",
        status: "removed",
      })
    )
    await act(async () => Promise.resolve())
    expect(result.current.relay?.status).toBe("removed")
  })

  it("invalidates stale recovery when an external remove event arrives", async () => {
    const { api, useRelayDraft } = await setup()
    const recovery = deferred<RelayContextPack | null>()
    vi.mocked(api.getRelayContextByDraft).mockReturnValue(recovery.promise)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(api.getRelayContextByDraft).toHaveBeenCalled())

    act(() =>
      emitRelay({
        relayId: pack.id,
        targetDraftId: "draft-1",
        status: "removed",
      })
    )
    recovery.resolve(pack)

    await act(async () => Promise.resolve())
    expect(result.current.relay).toBeNull()
  })

  it("invalidates recovery when the removed relay differs from the rendered relay", async () => {
    const { api, useRelayDraft } = await setup()
    const recovery = deferred<RelayContextPack | null>()
    const recoveredPack = makePack({ id: 8 })
    vi.mocked(api.getRelayContextByDraft)
      .mockResolvedValueOnce(pack)
      .mockReturnValueOnce(recovery.promise)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))

    act(() => {
      for (const handler of [...reconnectHandlers]) handler()
    })
    await waitFor(() =>
      expect(api.getRelayContextByDraft).toHaveBeenCalledTimes(2)
    )

    act(() =>
      emitRelay({
        relayId: recoveredPack.id,
        targetDraftId: "draft-1",
        status: "removed",
      })
    )
    await act(async () => {
      recovery.resolve(recoveredPack)
      await recovery.promise
    })

    expect(result.current.relay).toEqual(pack)
    expect(result.current.loading).toBe(false)
  })

  it("undoes removal by previewing a new active pack instead of restoring the removed row", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    const { result } = renderHook(() =>
      useRelayDraft({ ...defaultOptions, targetModel: "gpt-5.4" })
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

  it("keeps the original undo deadline when undo preview fails", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.getRelayContextByDraft).mockResolvedValue(pack)
    vi.mocked(api.previewRelayContext).mockRejectedValue(
      new Error("relay_summary_unavailable")
    )
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.relay).toEqual(pack))
    vi.useFakeTimers()

    await act(async () => result.current.remove())
    await act(async () => {
      await expect(result.current.undoRemove()).rejects.toThrow(
        "relay_summary_unavailable"
      )
    })
    act(() => vi.advanceTimersByTime(10_000))

    expect(result.current.relay).toBeNull()
  })

  it("retries an initial preview failure even when no relay pack exists yet", async () => {
    const { api, useRelayDraft } = await setup()
    vi.mocked(api.previewRelayContext)
      .mockRejectedValueOnce(new Error("relay_summary_unavailable"))
      .mockResolvedValueOnce(pack)
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.preview(44)).rejects.toThrow(
        "relay_summary_unavailable"
      )
    })
    expect(result.current.recoveryError).toBe(true)
    await act(async () => result.current.retry())

    expect(api.previewRelayContext).toHaveBeenCalledTimes(2)
    expect(result.current.relay).toEqual(pack)
    expect(result.current.recoveryError).toBe(false)
  })

  it("defaults an initial preview to the recent-rounds range", async () => {
    const { api, useRelayDraft } = await setup()
    const { result } = renderHook(() => useRelayDraft(defaultOptions))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => result.current.preview(44))

    expect(api.previewRelayContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
      }),
      expect.any(AbortSignal)
    )
  })

  it("passes a null target folder through for an unscoped draft", async () => {
    const { api, useRelayDraft } = await setup()
    const { result } = renderHook(() =>
      useRelayDraft({ ...defaultOptions, targetFolderId: null })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => result.current.preview(44))

    expect(api.previewRelayContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetFolderId: null }),
      expect.any(AbortSignal)
    )
  })
})

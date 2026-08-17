import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationRelayChange, RelayProvenance } from "@/lib/types"

vi.mock("@/lib/conversation-relay", () => ({
  getConversationRelay: vi.fn(),
}))

type EventHandler = (value: unknown) => void
const eventHandlers = new Map<string, Set<EventHandler>>()
const reconnectHandlers = new Set<() => void>()
let subscriptionGate: Promise<void> | null = null
const unsubscribe = vi.fn()
const offReconnect = vi.fn()

vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn((event: string, handler: EventHandler) => {
    const handlers = eventHandlers.get(event) ?? new Set<EventHandler>()
    handlers.add(handler)
    eventHandlers.set(event, handlers)
    return (subscriptionGate ?? Promise.resolve()).then(() => {
      return () => {
        handlers.delete(handler)
        unsubscribe(event)
      }
    })
  }),
  onTransportReconnect: vi.fn((handler: () => void) => {
    reconnectHandlers.add(handler)
    return () => {
      reconnectHandlers.delete(handler)
      offReconnect()
    }
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function provenance(relayId: number): RelayProvenance {
  return {
    relayId,
    snapshotSha256: "a".repeat(64),
    source: { conversationId: 11, folderId: 2, title: "产品需求讨论" },
    scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
    summary: null,
    includedRounds: [],
    files: [],
    stats: { messageCount: 2, fileCount: 0, todoCount: 0 },
    consumedAt: "2026-08-15T08:00:00Z",
  }
}

function emit(change: ConversationRelayChange) {
  for (const handler of [
    ...(eventHandlers.get("conversation-relay://changed") ?? []),
  ]) {
    handler(change)
  }
}

function reconnect() {
  for (const handler of [...reconnectHandlers]) handler()
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(
    (await import("@/lib/conversation-relay")).getConversationRelay
  ).mockReset()
  eventHandlers.clear()
  reconnectHandlers.clear()
  subscriptionGate = null
})

describe("useConversationRelay", () => {
  it("does not request a virtual id and requests after a positive id is bound", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationRelay).mockResolvedValue(provenance(7))
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(
      ({ conversationId }: { conversationId: number | null }) =>
        useConversationRelay(conversationId),
      { initialProps: { conversationId: -8 as number | null } }
    )

    expect(api.getConversationRelay).not.toHaveBeenCalled()
    expect(view.result.current.provenance).toBeNull()

    view.rerender({ conversationId: 42 })
    await waitFor(() =>
      expect(api.getConversationRelay).toHaveBeenCalledWith(42)
    )
    expect(view.result.current.provenance?.relayId).toBe(7)
  })

  it("does not request conversation zero", async () => {
    const api = await import("@/lib/conversation-relay")
    const { useConversationRelay } = await import("./use-conversation-relay")

    renderHook(() => useConversationRelay(0))
    await act(async () => Promise.resolve())

    expect(api.getConversationRelay).not.toHaveBeenCalled()
  })

  it("reloads provenance after the transport reconnects", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationRelay)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(provenance(12))
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(() => useConversationRelay(42))
    await waitFor(() => expect(api.getConversationRelay).toHaveBeenCalledOnce())

    act(() => reconnect())

    await waitFor(() =>
      expect(view.result.current.provenance?.relayId).toBe(12)
    )
    expect(api.getConversationRelay).toHaveBeenCalledTimes(2)
  })

  it("unsubscribes when an asynchronous subscription resolves after unmount", async () => {
    const gate = deferred<void>()
    subscriptionGate = gate.promise
    const api = await import("@/lib/conversation-relay")
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(() => useConversationRelay(42))

    view.unmount()
    await act(async () => gate.resolve())

    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
    expect(offReconnect).toHaveBeenCalledOnce()
    expect(api.getConversationRelay).not.toHaveBeenCalled()
  })

  it("refreshes only for a consumed event targeting this conversation", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationRelay)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(provenance(9))
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(() => useConversationRelay(42))

    await waitFor(() => expect(api.getConversationRelay).toHaveBeenCalledOnce())
    act(() =>
      emit({
        relayId: 8,
        targetDraftId: "draft-other",
        targetConversationId: 41,
        status: "consumed",
      })
    )
    await act(async () => Promise.resolve())
    expect(api.getConversationRelay).toHaveBeenCalledOnce()

    act(() =>
      emit({
        relayId: 9,
        targetDraftId: "draft-current",
        targetConversationId: 42,
        status: "consumed",
      })
    )
    await waitFor(() => expect(view.result.current.provenance?.relayId).toBe(9))
    expect(api.getConversationRelay).toHaveBeenCalledTimes(2)
  })

  it("ignores a request that resolves after the queried conversation changes", async () => {
    const api = await import("@/lib/conversation-relay")
    let resolveOld!: (value: RelayProvenance | null) => void
    const oldRequest = new Promise<RelayProvenance | null>((resolve) => {
      resolveOld = resolve
    })
    vi.mocked(api.getConversationRelay).mockImplementation((id) =>
      id === 42 ? oldRequest : Promise.resolve(provenance(10))
    )
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(
      ({ conversationId }) => useConversationRelay(conversationId),
      { initialProps: { conversationId: 42 } }
    )
    await waitFor(() =>
      expect(api.getConversationRelay).toHaveBeenCalledWith(42)
    )

    view.rerender({ conversationId: 43 })
    await waitFor(() =>
      expect(view.result.current.provenance?.relayId).toBe(10)
    )
    await act(async () => resolveOld(provenance(7)))

    expect(view.result.current.provenance?.relayId).toBe(10)
  })

  it("ignores an initial request overtaken by a consumed event for the same conversation", async () => {
    const api = await import("@/lib/conversation-relay")
    const initial = deferred<RelayProvenance | null>()
    vi.mocked(api.getConversationRelay)
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(provenance(13))
    const { useConversationRelay } = await import("./use-conversation-relay")
    const view = renderHook(() => useConversationRelay(42))
    await waitFor(() => expect(api.getConversationRelay).toHaveBeenCalledOnce())

    act(() =>
      emit({
        relayId: 13,
        targetDraftId: "draft-current",
        targetConversationId: 42,
        status: "consumed",
      })
    )
    await waitFor(() =>
      expect(view.result.current.provenance?.relayId).toBe(13)
    )
    await act(async () => initial.resolve(provenance(7)))

    expect(view.result.current.provenance?.relayId).toBe(13)
  })
})

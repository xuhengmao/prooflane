import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationCapabilitySettings } from "@/lib/types"

vi.mock("@/lib/conversation-relay", () => ({
  getConversationCapabilities: vi.fn(),
  updateConversationCapabilities: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let settingsHandler:
  | ((settings: ConversationCapabilitySettings) => void)
  | null = null
let reconnectHandler: (() => void) | null = null
let subscribeResult: Promise<() => void> | null = null
const unsubscribe = vi.fn()
const offReconnect = vi.fn()

vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(
    (
      _event: string,
      handler: (settings: ConversationCapabilitySettings) => void
    ) => {
      settingsHandler = handler
      return subscribeResult ?? Promise.resolve(unsubscribe)
    }
  ),
  onTransportReconnect: vi.fn((handler: () => void) => {
    reconnectHandler = handler
    return offReconnect
  }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  settingsHandler = null
  reconnectHandler = null
  subscribeResult = null
})

describe("useConversationCapabilities", () => {
  it("waits for the cross-window subscription before reading the initial snapshot", async () => {
    const api = await import("@/lib/conversation-relay")
    const subscription = deferred<() => void>()
    subscribeResult = subscription.promise
    vi.mocked(api.getConversationCapabilities).mockResolvedValue({
      relayEnabled: true,
    })

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    renderHook(() => useConversationCapabilities())

    await waitFor(() => expect(settingsHandler).not.toBeNull())
    expect(api.getConversationCapabilities).not.toHaveBeenCalled()

    subscription.resolve(unsubscribe)
    await waitFor(() =>
      expect(api.getConversationCapabilities).toHaveBeenCalledOnce()
    )
  })

  it("applies a newer cross-window disable over a stale initial fetch", async () => {
    const api = await import("@/lib/conversation-relay")
    const pending = deferred<ConversationCapabilitySettings>()
    vi.mocked(api.getConversationCapabilities).mockReturnValue(pending.promise)

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    const { result } = renderHook(() => useConversationCapabilities())

    await waitFor(() =>
      expect(api.getConversationCapabilities).toHaveBeenCalledOnce()
    )
    act(() => settingsHandler?.({ relayEnabled: false }))
    pending.resolve({ relayEnabled: true })

    await waitFor(() =>
      expect(result.current.settings.relayEnabled).toBe(false)
    )
  })

  it("does not let a stale reconnect snapshot overwrite a newer event", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationCapabilities).mockResolvedValueOnce({
      relayEnabled: true,
    })

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    const { result } = renderHook(() => useConversationCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const reconnectSnapshot = deferred<ConversationCapabilitySettings>()
    vi.mocked(api.getConversationCapabilities).mockReturnValueOnce(
      reconnectSnapshot.promise
    )
    act(() => reconnectHandler?.())
    await waitFor(() =>
      expect(api.getConversationCapabilities).toHaveBeenCalledTimes(2)
    )

    act(() => settingsHandler?.({ relayEnabled: false }))
    reconnectSnapshot.resolve({ relayEnabled: true })

    await waitFor(() =>
      expect(result.current.settings.relayEnabled).toBe(false)
    )
  })

  it("keeps the newest local save when responses resolve in reverse order", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationCapabilities).mockResolvedValue({
      relayEnabled: false,
    })
    const older = deferred<ConversationCapabilitySettings>()
    const newer = deferred<ConversationCapabilitySettings>()
    vi.mocked(api.updateConversationCapabilities)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    const { result } = renderHook(() => useConversationCapabilities())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let olderSave!: Promise<void>
    let newerSave!: Promise<void>
    act(() => {
      olderSave = result.current.setRelayEnabled(true)
      newerSave = result.current.setRelayEnabled(false)
    })

    newer.resolve({ relayEnabled: false })
    await act(async () => newerSave)
    older.resolve({ relayEnabled: true })
    await act(async () => olderSave)

    expect(result.current.settings.relayEnabled).toBe(false)
  })

  it("updates every mounted consumer after a successful local save", async () => {
    const api = await import("@/lib/conversation-relay")
    vi.mocked(api.getConversationCapabilities).mockResolvedValue({
      relayEnabled: true,
    })
    vi.mocked(api.updateConversationCapabilities).mockResolvedValue({
      relayEnabled: false,
    })

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    const first = renderHook(() => useConversationCapabilities())
    const second = renderHook(() => useConversationCapabilities())
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    await act(async () => {
      await first.result.current.setRelayEnabled(false)
    })

    expect(first.result.current.settings.relayEnabled).toBe(false)
    expect(second.result.current.settings.relayEnabled).toBe(false)
  })
})

import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationCapabilitySettings } from "@/lib/types"

vi.mock("@/lib/conversation-relay", () => ({
  getConversationCapabilities: vi.fn(),
  updateConversationCapabilities: vi.fn(),
}))

let settingsHandler:
  | ((settings: ConversationCapabilitySettings) => void)
  | null = null
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(
    async (
      _event: string,
      handler: (settings: ConversationCapabilitySettings) => void
    ) => {
      settingsHandler = handler
      return () => {}
    }
  ),
  onTransportReconnect: vi.fn(() => () => {}),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  settingsHandler = null
})

describe("useConversationCapabilities", () => {
  it("applies a newer cross-window disable over a stale initial fetch", async () => {
    const api = await import("@/lib/conversation-relay")
    const pending = deferred<ConversationCapabilitySettings>()
    vi.mocked(api.getConversationCapabilities).mockReturnValue(pending.promise)

    const { useConversationCapabilities } =
      await import("./use-conversation-capabilities")
    const { result } = renderHook(() => useConversationCapabilities())

    await waitFor(() => expect(settingsHandler).not.toBeNull())
    act(() => settingsHandler?.({ relayEnabled: false }))
    pending.resolve({ relayEnabled: true })

    await waitFor(() =>
      expect(result.current.settings.relayEnabled).toBe(false)
    )
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

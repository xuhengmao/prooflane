import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { queueRelayIntent } from "@/lib/conversation-relay"
import {
  isRelayEntryBlockingFirstSend,
  useRelayEntryIntent,
} from "./use-relay-entry-intent"

describe("relay entry send policy", () => {
  it("blocks an unpersisted first send until a failed entry is retried or removed", () => {
    expect(isRelayEntryBlockingFirstSend("loading", false)).toBe(true)
    expect(isRelayEntryBlockingFirstSend("loading", true)).toBe(false)
    expect(isRelayEntryBlockingFirstSend("error", false)).toBe(true)
    expect(isRelayEntryBlockingFirstSend("error", true)).toBe(false)
    expect(isRelayEntryBlockingFirstSend(null, false)).toBe(false)
  })
})

describe("useRelayEntryIntent", () => {
  it("shows a failed automatic entry and retries the same source", async () => {
    let rejectPreview: (error: Error) => void = () => {}
    const preview = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPreview = reject
        })
    )
    queueRelayIntent({ tabId: "relay-entry-retry", sourceConversationId: 42 })

    const view = renderHook(() =>
      useRelayEntryIntent({
        tabId: "relay-entry-retry",
        enabled: true,
        preview,
      })
    )

    await waitFor(() =>
      expect(view.result.current.entry).toEqual({
        status: "loading",
        sourceConversationId: 42,
      })
    )
    act(() => rejectPreview(new Error("source unavailable")))
    await waitFor(() => expect(view.result.current.entry?.status).toBe("error"))

    preview.mockResolvedValueOnce(undefined)
    act(() => view.result.current.retry())
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.entry).toBeNull())
  })

  it("ignores an older failure after a newer intent starts", async () => {
    const requests = new Map<
      number,
      { resolve: () => void; reject: (error: Error) => void }
    >()
    const preview = vi.fn(
      (sourceConversationId: number) =>
        new Promise<void>((resolve, reject) => {
          requests.set(sourceConversationId, { resolve, reject })
        })
    )
    const view = renderHook(() =>
      useRelayEntryIntent({
        tabId: "relay-entry-generation",
        enabled: true,
        preview,
      })
    )

    act(() =>
      queueRelayIntent({
        tabId: "relay-entry-generation",
        sourceConversationId: 10,
      })
    )
    await waitFor(() => expect(preview).toHaveBeenCalledWith(10))
    act(() =>
      queueRelayIntent({
        tabId: "relay-entry-generation",
        sourceConversationId: 20,
      })
    )
    await waitFor(() => expect(preview).toHaveBeenCalledWith(20))

    act(() => requests.get(10)?.reject(new Error("stale failure")))
    expect(view.result.current.entry).toEqual({
      status: "loading",
      sourceConversationId: 20,
    })

    act(() => requests.get(20)?.resolve())
    await waitFor(() => expect(view.result.current.entry).toBeNull())
  })
})

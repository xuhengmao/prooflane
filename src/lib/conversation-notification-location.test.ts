import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  consumeConversationNotificationLocation,
  getConversationNotificationLocation,
  getConversationNotificationLocationVersion,
  requestConversationNotificationLocation,
  resetConversationNotificationLocationsForTests,
  resolveConversationNotificationLocationIndex,
  subscribeConversationNotificationLocations,
} from "./conversation-notification-location"

describe("conversation notification location requests", () => {
  beforeEach(() => resetConversationNotificationLocationsForTests())

  it("keeps a request pending until the matching view consumes it", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConversationNotificationLocations(listener)

    const request = requestConversationNotificationLocation({
      conversationId: 42,
      messageId: "assistant-1",
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getConversationNotificationLocationVersion()).toBe(1)
    expect(getConversationNotificationLocation(42)).toEqual(request)
    expect(consumeConversationNotificationLocation(42, request.id)).toBe(true)
    expect(getConversationNotificationLocation(42)).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it("does not let a stale view consume a newer request", () => {
    const first = requestConversationNotificationLocation({
      conversationId: 42,
      messageId: null,
    })
    const second = requestConversationNotificationLocation({
      conversationId: 42,
      messageId: "assistant-2",
    })

    expect(consumeConversationNotificationLocation(42, first.id)).toBe(false)
    expect(getConversationNotificationLocation(42)).toEqual(second)
  })
})

describe("resolveConversationNotificationLocationIndex", () => {
  const items = [
    { key: "user-1", messageIds: ["user-1"] },
    { key: "assistant-group", messageIds: ["assistant-1", "assistant-2"] },
    { key: "assistant-3", messageIds: ["assistant-3"] },
  ]

  it("returns the row containing the requested raw message id", () => {
    expect(
      resolveConversationNotificationLocationIndex(items, "assistant-2")
    ).toBe(1)
  })

  it("falls back to the latest row when the anchor is absent or unavailable", () => {
    expect(resolveConversationNotificationLocationIndex(items, null)).toBe(2)
    expect(
      resolveConversationNotificationLocationIndex(items, "not-loaded")
    ).toBe(2)
    expect(resolveConversationNotificationLocationIndex([], null)).toBe(-1)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY,
  DEFAULT_CONVERSATION_NOTIFICATION_PREFS,
  getConversationNotificationPrefs,
  loadConversationNotificationPrefs,
  parseConversationNotificationPrefs,
  resetConversationNotificationPrefsCacheForTests,
  saveConversationNotificationPrefs,
  subscribeConversationNotificationPrefs,
} from "./conversation-notification-prefs"

describe("conversation notification preferences", () => {
  beforeEach(() => {
    localStorage.clear()
    resetConversationNotificationPrefsCacheForTests()
  })

  it("starts enabled on a device without stored preferences", () => {
    expect(DEFAULT_CONVERSATION_NOTIFICATION_PREFS.enabled).toBe(true)
    expect(loadConversationNotificationPrefs()).toEqual({ enabled: true })
  })

  it("keeps valid fields and falls back each damaged field independently", () => {
    expect(parseConversationNotificationPrefs({ enabled: false })).toEqual({
      enabled: false,
    })
    expect(parseConversationNotificationPrefs({ enabled: "disabled" })).toEqual(
      { enabled: true }
    )
    expect(parseConversationNotificationPrefs(null)).toEqual({ enabled: true })
  })

  it("falls back to the defaults when the stored JSON is corrupt", () => {
    localStorage.setItem(
      CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY,
      "{not json"
    )

    expect(loadConversationNotificationPrefs()).toEqual({ enabled: true })
  })

  it("notifies this window and refreshes the shared snapshot on save", () => {
    const seen: boolean[] = []
    const unsubscribe = subscribeConversationNotificationPrefs(() => {
      seen.push(getConversationNotificationPrefs().enabled)
    })

    saveConversationNotificationPrefs({ enabled: false })
    unsubscribe()
    saveConversationNotificationPrefs({ enabled: true })

    expect(seen).toEqual([false])
    expect(
      JSON.parse(
        localStorage.getItem(
          CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY
        ) as string
      )
    ).toEqual({ enabled: true })
  })

  it("refreshes subscribers when another window changes the stored value", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConversationNotificationPrefs(listener)
    expect(getConversationNotificationPrefs().enabled).toBe(true)

    const stored = JSON.stringify({ enabled: false })
    localStorage.setItem(CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY, stored)
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY,
        newValue: stored,
      })
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getConversationNotificationPrefs().enabled).toBe(false)
    unsubscribe()
  })

  it("ignores storage events for unrelated settings", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeConversationNotificationPrefs(listener)

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "settings:unrelated:v1",
        newValue: "true",
      })
    )

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("keeps snapshot identity stable until its persisted value changes", () => {
    const first = getConversationNotificationPrefs()
    expect(getConversationNotificationPrefs()).toBe(first)

    saveConversationNotificationPrefs({ enabled: false })

    const second = getConversationNotificationPrefs()
    expect(second).not.toBe(first)
    expect(second.enabled).toBe(false)
  })
})

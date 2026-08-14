"use client"

import { useSyncExternalStore } from "react"

export const CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY =
  "settings:conversation-notification:v1"

const CONVERSATION_NOTIFICATION_PREFS_EVENT =
  "prooflane:conversation-notification-changed"

export interface ConversationNotificationPrefs {
  enabled: boolean
}

export const DEFAULT_CONVERSATION_NOTIFICATION_PREFS: ConversationNotificationPrefs =
  {
    enabled: true,
  }

function defaultPrefs(): ConversationNotificationPrefs {
  return { ...DEFAULT_CONVERSATION_NOTIFICATION_PREFS }
}

export function parseConversationNotificationPrefs(
  raw: unknown
): ConversationNotificationPrefs {
  if (!raw || typeof raw !== "object") return defaultPrefs()

  const source = raw as Record<string, unknown>
  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_CONVERSATION_NOTIFICATION_PREFS.enabled,
  }
}

export function loadConversationNotificationPrefs(): ConversationNotificationPrefs {
  if (typeof window === "undefined") return defaultPrefs()

  try {
    const stored = window.localStorage.getItem(
      CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY
    )
    return stored
      ? parseConversationNotificationPrefs(JSON.parse(stored))
      : defaultPrefs()
  } catch {
    return defaultPrefs()
  }
}

export function saveConversationNotificationPrefs(
  prefs: ConversationNotificationPrefs
): void {
  if (typeof window === "undefined") return

  const parsed = parseConversationNotificationPrefs(prefs)
  try {
    window.localStorage.setItem(
      CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY,
      JSON.stringify(parsed)
    )
  } catch {
    // Storage may be unavailable; same-window consumers still update.
  }
  window.dispatchEvent(
    new CustomEvent(CONVERSATION_NOTIFICATION_PREFS_EVENT, {
      detail: parsed,
    })
  )
}

let snapshot: ConversationNotificationPrefs | null = null
const listeners = new Set<() => void>()
let windowBound = false

function invalidateSnapshot(): void {
  snapshot = null
  for (const listener of listeners) listener()
}

function bindWindow(): void {
  if (windowBound || typeof window === "undefined") return
  windowBound = true

  window.addEventListener(
    CONVERSATION_NOTIFICATION_PREFS_EVENT,
    invalidateSnapshot
  )
  window.addEventListener("storage", (event) => {
    if (
      event.key === null ||
      event.key === CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY
    ) {
      invalidateSnapshot()
    }
  })
}

export function getConversationNotificationPrefs(): ConversationNotificationPrefs {
  bindWindow()
  if (typeof window === "undefined") {
    return DEFAULT_CONVERSATION_NOTIFICATION_PREFS
  }
  snapshot ??= loadConversationNotificationPrefs()
  return snapshot
}

export function subscribeConversationNotificationPrefs(
  onChange: () => void
): () => void {
  bindWindow()
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

function getServerConversationNotificationPrefs(): ConversationNotificationPrefs {
  return DEFAULT_CONVERSATION_NOTIFICATION_PREFS
}

export function useConversationNotificationPrefs(): ConversationNotificationPrefs {
  return useSyncExternalStore(
    subscribeConversationNotificationPrefs,
    getConversationNotificationPrefs,
    getServerConversationNotificationPrefs
  )
}

export function resetConversationNotificationPrefsCacheForTests(): void {
  snapshot = null
}

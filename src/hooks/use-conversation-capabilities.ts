"use client"

import { useCallback, useEffect, useState } from "react"

import {
  getConversationCapabilities,
  updateConversationCapabilities,
} from "@/lib/conversation-relay"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import {
  CONVERSATION_CAPABILITIES_CHANGED_EVENT,
  type ConversationCapabilitySettings,
} from "@/lib/types"

const DEFAULT_SETTINGS: ConversationCapabilitySettings = { relayEnabled: true }

let cached: ConversationCapabilitySettings | null = null
let inflight: Promise<ConversationCapabilitySettings> | null = null
let syncReady: Promise<void> | null = null
let reconnectWired = false
let stateGeneration = 0
let saveGeneration = 0
const listeners = new Set<(settings: ConversationCapabilitySettings) => void>()

function notify(settings: ConversationCapabilitySettings): void {
  for (const listener of listeners) listener(settings)
}

function applySettings(settings: ConversationCapabilitySettings): void {
  stateGeneration += 1
  cached = settings
  notify(settings)
}

async function refreshFromBackend(
  fallback?: ConversationCapabilitySettings
): Promise<ConversationCapabilitySettings> {
  const startGeneration = stateGeneration
  const settings = await getConversationCapabilities().catch((error) => {
    if (fallback) return fallback
    throw error
  })
  if (stateGeneration === startGeneration) applySettings(settings)
  return cached ?? settings
}

function ensureCrossWindowSync(): Promise<void> {
  if (!syncReady) {
    syncReady = subscribe<ConversationCapabilitySettings>(
      CONVERSATION_CAPABILITIES_CHANGED_EVENT,
      applySettings
    )
      .then(() => undefined)
      .catch(() => {
        syncReady = null
      })
  }

  if (!reconnectWired) {
    reconnectWired = true
    onTransportReconnect(() => {
      void ensureCrossWindowSync()
        .then(() => refreshFromBackend())
        .catch(() => {})
    })
  }

  return syncReady
}

function ensureLoaded(): Promise<ConversationCapabilitySettings> {
  if (inflight) return inflight
  inflight = ensureCrossWindowSync()
    .then(() => refreshFromBackend(DEFAULT_SETTINGS))
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useConversationCapabilities(): {
  settings: ConversationCapabilitySettings
  loading: boolean
  setRelayEnabled: (relayEnabled: boolean) => Promise<void>
} {
  const [settings, setSettings] = useState<ConversationCapabilitySettings>(
    () => cached ?? DEFAULT_SETTINGS
  )
  const [loading, setLoading] = useState(() => cached === null)

  useEffect(() => {
    let active = true
    listeners.add(setSettings)
    if (cached === null) {
      void ensureLoaded().finally(() => {
        if (active) setLoading(false)
      })
    }
    return () => {
      active = false
      listeners.delete(setSettings)
    }
  }, [])

  const setRelayEnabled = useCallback(async (relayEnabled: boolean) => {
    const requestGeneration = ++saveGeneration
    stateGeneration += 1
    const updated = await updateConversationCapabilities({ relayEnabled })
    if (requestGeneration === saveGeneration) applySettings(updated)
  }, [])

  return { settings, loading, setRelayEnabled }
}

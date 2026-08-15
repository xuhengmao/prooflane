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
let generation = 0
let syncWired = false
const listeners = new Set<(settings: ConversationCapabilitySettings) => void>()

function notify(settings: ConversationCapabilitySettings): void {
  for (const listener of listeners) listener(settings)
}

function applySettings(settings: ConversationCapabilitySettings): void {
  generation += 1
  cached = settings
  notify(settings)
}

function ensureLoaded(): Promise<ConversationCapabilitySettings> {
  if (inflight) return inflight
  const startGeneration = generation
  inflight = getConversationCapabilities()
    .catch(() => DEFAULT_SETTINGS)
    .then((settings) => {
      if (generation === startGeneration) {
        cached = settings
        notify(settings)
      }
      return cached ?? settings
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function ensureCrossWindowSync(): void {
  if (syncWired) return
  syncWired = true
  void subscribe<ConversationCapabilitySettings>(
    CONVERSATION_CAPABILITIES_CHANGED_EVENT,
    applySettings
  ).catch(() => {
    syncWired = false
  })
  onTransportReconnect(() => {
    void getConversationCapabilities()
      .then(applySettings)
      .catch(() => {})
  })
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
    ensureCrossWindowSync()
    listeners.add(setSettings)
    if (cached === null) {
      void ensureLoaded().finally(() => setLoading(false))
    }
    return () => {
      listeners.delete(setSettings)
    }
  }, [])

  const setRelayEnabled = useCallback(async (relayEnabled: boolean) => {
    const updated = await updateConversationCapabilities({ relayEnabled })
    applySettings(updated)
  }, [])

  return { settings, loading, setRelayEnabled }
}

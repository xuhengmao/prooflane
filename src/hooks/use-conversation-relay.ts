"use client"

import { useEffect, useState } from "react"

import { getConversationRelay } from "@/lib/conversation-relay"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import {
  CONVERSATION_RELAY_CHANGED_EVENT,
  type ConversationRelayChange,
  type RelayProvenance,
} from "@/lib/types"

export function useConversationRelay(conversationId: number | null): {
  provenance: RelayProvenance | null
  loading: boolean
} {
  const [provenance, setProvenance] = useState<RelayProvenance | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let disposed = false
    let requestGeneration = 0
    let unsubscribe: (() => void) | null = null

    setProvenance(null)
    if (conversationId == null || conversationId <= 0) {
      setLoading(false)
      return () => {
        disposed = true
      }
    }
    setLoading(true)

    const load = async () => {
      const generation = ++requestGeneration
      setLoading(true)
      try {
        const next = await getConversationRelay(conversationId)
        if (!disposed && generation === requestGeneration) {
          setProvenance(next)
        }
      } finally {
        if (!disposed && generation === requestGeneration) {
          setLoading(false)
        }
      }
    }

    const offReconnect = onTransportReconnect(() => {
      if (!disposed) void load().catch(() => {})
    })

    void subscribe<ConversationRelayChange>(
      CONVERSATION_RELAY_CHANGED_EVENT,
      (change) => {
        if (
          disposed ||
          change.status !== "consumed" ||
          change.targetConversationId !== conversationId
        ) {
          return
        }
        void load().catch(() => {})
      }
    )
      .then((off) => {
        if (disposed) off()
        else unsubscribe = off
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) void load().catch(() => {})
      })

    return () => {
      disposed = true
      requestGeneration += 1
      unsubscribe?.()
      offReconnect?.()
    }
  }, [conversationId])

  return { provenance, loading }
}

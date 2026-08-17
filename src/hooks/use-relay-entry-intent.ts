"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  consumeRelayIntent,
  subscribeRelayIntent,
} from "@/lib/conversation-relay"

interface RelayEntryIntentOptions {
  tabId: string
  enabled: boolean
  preview: (sourceConversationId: number) => Promise<void>
}

export interface RelayEntryIntentState {
  status: "loading" | "error"
  sourceConversationId: number
}

interface InternalRelayEntryIntentState extends RelayEntryIntentState {
  tabId: string
}

export function isRelayEntryBlockingFirstSend(
  status: "loading" | "error" | null,
  hasPersistedConversation: boolean
): boolean {
  return status !== null && !hasPersistedConversation
}

export function useRelayEntryIntent({
  tabId,
  enabled,
  preview,
}: RelayEntryIntentOptions): {
  entry: RelayEntryIntentState | null
  retry: () => void
  clear: () => void
} {
  const [internalEntry, setInternalEntry] =
    useState<InternalRelayEntryIntentState | null>(null)
  const entryRef = useRef<InternalRelayEntryIntentState | null>(null)
  const previewRef = useRef(preview)
  const tabIdRef = useRef(tabId)
  const generationRef = useRef(0)

  useEffect(() => {
    previewRef.current = preview
  }, [preview])

  useEffect(() => {
    tabIdRef.current = tabId
  }, [tabId])

  const commitEntry = useCallback(
    (next: InternalRelayEntryIntentState | null) => {
      entryRef.current = next
      setInternalEntry(next)
    },
    []
  )

  const clear = useCallback(() => {
    generationRef.current += 1
    commitEntry(null)
  }, [commitEntry])

  const run = useCallback(
    (sourceConversationId: number, targetTabId: string) => {
      const generation = ++generationRef.current
      commitEntry({
        tabId: targetTabId,
        status: "loading",
        sourceConversationId,
      })
      void previewRef.current(sourceConversationId).then(
        () => {
          if (
            generationRef.current === generation &&
            tabIdRef.current === targetTabId
          ) {
            commitEntry(null)
          }
        },
        () => {
          if (
            generationRef.current === generation &&
            tabIdRef.current === targetTabId
          ) {
            commitEntry({
              tabId: targetTabId,
              status: "error",
              sourceConversationId,
            })
          }
        }
      )
    },
    [commitEntry]
  )

  const retry = useCallback(() => {
    const current = entryRef.current
    if (current?.status !== "error" || current.tabId !== tabIdRef.current) {
      return
    }
    run(current.sourceConversationId, current.tabId)
  }, [run])

  useEffect(() => {
    if (!enabled) return
    const consume = () => {
      const intent = consumeRelayIntent(tabId)
      if (intent) run(intent.sourceConversationId, tabId)
    }
    const unsubscribe = subscribeRelayIntent(tabId, consume)
    consume()
    return unsubscribe
  }, [enabled, run, tabId])

  useEffect(() => {
    // The external capability toggle must invalidate in-flight work and discard
    // transient entry feedback before a later re-enable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled) clear()
  }, [clear, enabled])

  const entry =
    enabled && internalEntry?.tabId === tabId
      ? {
          status: internalEntry.status,
          sourceConversationId: internalEntry.sourceConversationId,
        }
      : null

  return { entry, retry, clear }
}

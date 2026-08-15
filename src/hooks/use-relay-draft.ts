"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  getRelayContextByDraft,
  previewRelayContext,
  removeRelayContext,
  updateRelayContext,
} from "@/lib/conversation-relay"
import { extractAppCommandError } from "@/lib/app-error"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import {
  CONVERSATION_CAPABILITIES_CHANGED_EVENT,
  CONVERSATION_RELAY_CHANGED_EVENT,
  RELAY_BUDGET_EXCEEDED,
  type AgentType,
  type ConversationCapabilitySettings,
  type ConversationRelayChange,
  type RelayContextPack,
  type RelayScopeSelection,
} from "@/lib/types"

const UNDO_REMOVE_WINDOW_MS = 10_000
const DEFAULT_SCOPE: RelayScopeSelection = {
  scopeType: "summary",
  selectedRoundIds: [],
}

interface RelayDraftOptions {
  targetDraftId: string
  targetFolderId: number
  targetAgentType: AgentType
  targetModel: string | null
  enabled: boolean
}

function isBudgetExceeded(error: unknown): boolean {
  if (extractAppCommandError(error)?.code === RELAY_BUDGET_EXCEEDED) {
    return true
  }
  if (!error || typeof error !== "object") {
    return error === RELAY_BUDGET_EXCEEDED
  }
  const value = error as { code?: unknown; message?: unknown }
  return (
    value.code === RELAY_BUDGET_EXCEEDED ||
    value.message === RELAY_BUDGET_EXCEEDED
  )
}

export function useRelayDraft({
  targetDraftId,
  targetFolderId,
  targetAgentType,
  targetModel,
  enabled,
}: RelayDraftOptions): {
  relay: RelayContextPack | null
  loading: boolean
  preview: (
    sourceConversationId: number,
    scope?: RelayScopeSelection
  ) => Promise<void>
  updateScope: (scope: RelayScopeSelection) => Promise<void>
  remove: () => Promise<void>
  undoRemove: () => Promise<void>
  retry: () => Promise<void>
} {
  const [relay, setRelay] = useState<RelayContextPack | null>(null)
  const [loading, setLoading] = useState(false)
  const relayRef = useRef<RelayContextPack | null>(null)
  const latestRef = useRef({
    targetDraftId,
    targetFolderId,
    targetAgentType,
    targetModel,
    enabled,
  })
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const allowedRef = useRef(enabled)
  const targetSignatureRef = useRef<string | null>(null)
  const locallyRemovedIdRef = useRef<number | null>(null)

  const commitRelay = useCallback((next: RelayContextPack | null) => {
    relayRef.current = next
    setRelay(next)
  }, [])

  const abortPending = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    generationRef.current += 1
  }, [])

  const loadExisting = useCallback(async () => {
    const requestGeneration = ++generationRef.current
    setLoading(true)
    try {
      const existing = await getRelayContextByDraft(
        latestRef.current.targetDraftId
      )
      if (mountedRef.current && requestGeneration === generationRef.current) {
        commitRelay(existing)
      }
    } finally {
      if (mountedRef.current && requestGeneration === generationRef.current) {
        setLoading(false)
      }
    }
  }, [commitRelay])

  useEffect(() => {
    latestRef.current = {
      targetDraftId,
      targetFolderId,
      targetAgentType,
      targetModel,
      enabled,
    }
  }, [targetAgentType, targetDraftId, targetFolderId, targetModel, enabled])

  useEffect(() => {
    allowedRef.current = enabled
    if (!enabled) {
      abortPending()
      commitRelay(null)
      setLoading(false)
      return
    }
    void loadExisting().catch(() => {})
  }, [abortPending, commitRelay, enabled, loadExisting, targetDraftId])

  const preview = useCallback(
    async (sourceConversationId: number, scope?: RelayScopeSelection) => {
      if (!allowedRef.current) return
      abortPending()
      const controller = new AbortController()
      abortRef.current = controller
      const requestGeneration = ++generationRef.current
      const current = latestRef.current
      const selectedScope = scope ?? relayRef.current?.scope ?? DEFAULT_SCOPE
      setLoading(true)
      try {
        const next = await previewRelayContext(
          {
            targetDraftId: current.targetDraftId,
            sourceConversationId,
            targetFolderId: current.targetFolderId,
            targetAgentType: current.targetAgentType,
            targetModel: current.targetModel,
            scope: selectedScope,
          },
          controller.signal
        )
        if (mountedRef.current && requestGeneration === generationRef.current) {
          commitRelay(next)
        }
      } finally {
        if (mountedRef.current && requestGeneration === generationRef.current) {
          abortRef.current = null
          setLoading(false)
        }
      }
    },
    [abortPending, commitRelay]
  )

  const updateScope = useCallback(
    async (scope: RelayScopeSelection) => {
      const currentRelay = relayRef.current
      if (
        !allowedRef.current ||
        !currentRelay ||
        currentRelay.status === "removed"
      )
        return
      const requestGeneration = ++generationRef.current
      setLoading(true)
      try {
        const current = latestRef.current
        const next = await updateRelayContext(currentRelay.id, {
          scope,
          targetAgentType: current.targetAgentType,
          targetModel: current.targetModel,
        })
        if (mountedRef.current && requestGeneration === generationRef.current) {
          commitRelay(next)
        }
      } catch (error) {
        if (
          mountedRef.current &&
          requestGeneration === generationRef.current &&
          isBudgetExceeded(error)
        ) {
          commitRelay({ ...currentRelay, invalidReason: RELAY_BUDGET_EXCEEDED })
          return
        }
        throw error
      } finally {
        if (mountedRef.current && requestGeneration === generationRef.current) {
          setLoading(false)
        }
      }
    },
    [commitRelay]
  )

  useEffect(() => {
    const signature = `${targetAgentType}\u0000${targetModel ?? ""}`
    if (targetSignatureRef.current === null) {
      targetSignatureRef.current = signature
      return
    }
    if (targetSignatureRef.current === signature || !relayRef.current) return
    targetSignatureRef.current = signature
    void updateScope(relayRef.current.scope).catch(() => {})
  }, [targetAgentType, targetModel, updateScope])

  const remove = useCallback(async () => {
    const currentRelay = relayRef.current
    if (!currentRelay || currentRelay.status === "removed") return
    abortPending()
    const removed = await removeRelayContext(currentRelay.id)
    if (!mountedRef.current) return
    locallyRemovedIdRef.current = removed.id
    commitRelay(removed)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      if (mountedRef.current && relayRef.current?.id === removed.id) {
        locallyRemovedIdRef.current = null
        commitRelay(null)
      }
    }, UNDO_REMOVE_WINDOW_MS)
  }, [abortPending, commitRelay])

  const undoRemove = useCallback(async () => {
    const removed = relayRef.current
    if (!removed || removed.status !== "removed") return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    locallyRemovedIdRef.current = null
    await preview(removed.sourceConversationId, removed.scope)
  }, [preview])

  const retry = useCallback(async () => {
    const currentRelay = relayRef.current
    if (!currentRelay) return
    await updateScope(currentRelay.scope)
  }, [updateScope])

  useEffect(() => {
    let disposed = false
    void subscribe<ConversationCapabilitySettings>(
      CONVERSATION_CAPABILITIES_CHANGED_EVENT,
      (settings) => {
        allowedRef.current = settings.relayEnabled
        if (!settings.relayEnabled) {
          abortPending()
          commitRelay(null)
          setLoading(false)
        }
      }
    ).catch(() => {})
    void subscribe<ConversationRelayChange>(
      CONVERSATION_RELAY_CHANGED_EVENT,
      (change) => {
        if (
          change.targetDraftId !== latestRef.current.targetDraftId ||
          disposed
        )
          return
        if (
          change.status === "removed" &&
          locallyRemovedIdRef.current !== change.relayId
        ) {
          commitRelay(null)
          return
        }
        if (allowedRef.current) void loadExisting().catch(() => {})
      }
    ).catch(() => {})
    const offReconnect = onTransportReconnect(() => {
      if (allowedRef.current) void loadExisting().catch(() => {})
    })
    return () => {
      disposed = true
      offReconnect?.()
    }
  }, [abortPending, commitRelay, loadExisting])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortPending()
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [abortPending])

  return { relay, loading, preview, updateScope, remove, undoRemove, retry }
}

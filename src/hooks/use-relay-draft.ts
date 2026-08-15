"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { extractAppCommandError } from "@/lib/app-error"
import {
  getRelayContextByDraft,
  previewRelayContext,
  removeRelayContext,
  updateRelayContext,
} from "@/lib/conversation-relay"
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
  targetFolderId: number | null
  targetAgentType: AgentType
  targetModel: string | null
  enabled: boolean
}

type RetryOperation =
  | { kind: "restore" }
  | {
      kind: "preview"
      sourceConversationId: number
      scope: RelayScopeSelection
    }
  | { kind: "update"; scope: RelayScopeSelection }

interface LocalRemoval {
  relayId: number
  targetDraftId: string
}

function isBudgetExceeded(error: unknown): boolean {
  const appError = extractAppCommandError(error)
  if (
    appError?.code === RELAY_BUDGET_EXCEEDED ||
    appError?.message === RELAY_BUDGET_EXCEEDED
  ) {
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError"
}

function targetSignature(agentType: AgentType, model: string | null): string {
  return `${agentType}\u0000${model ?? ""}`
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
  latestRef.current = {
    targetDraftId,
    targetFolderId,
    targetAgentType,
    targetModel,
    enabled,
  }

  const operationGenerationRef = useRef(0)
  const restoreGenerationRef = useRef<number | null>(null)
  const lifecycleGenerationRef = useRef(0)
  const previewAbortRef = useRef<AbortController | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  const subscriptionsReadyRef = useRef(false)
  const allowedRef = useRef(enabled)
  const localRemovalRef = useRef<LocalRemoval | null>(null)
  const retryOperationRef = useRef<RetryOperation | null>(null)
  const targetSignatureRef = useRef<string | null>(null)
  const configurationRefreshPendingRef = useRef(false)

  const commitRelay = useCallback((next: RelayContextPack | null) => {
    relayRef.current = next
    setRelay(next)
  }, [])

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
  }, [])

  const invalidatePending = useCallback(() => {
    previewAbortRef.current?.abort()
    previewAbortRef.current = null
    operationGenerationRef.current += 1
    return operationGenerationRef.current
  }, [])

  const isCurrent = useCallback(
    (generation: number, draftId: string, lifecycle: number) =>
      mountedRef.current &&
      operationGenerationRef.current === generation &&
      lifecycleGenerationRef.current === lifecycle &&
      latestRef.current.targetDraftId === draftId,
    []
  )

  const loadExisting = useCallback(async () => {
    if (!allowedRef.current || !subscriptionsReadyRef.current) return
    const current = latestRef.current
    const draftId = current.targetDraftId
    const lifecycle = lifecycleGenerationRef.current
    const generation = invalidatePending()
    restoreGenerationRef.current = generation
    retryOperationRef.current = null
    setLoading(true)
    try {
      const existing = await getRelayContextByDraft(draftId)
      if (isCurrent(generation, draftId, lifecycle)) commitRelay(existing)
    } catch (error) {
      if (isCurrent(generation, draftId, lifecycle)) {
        retryOperationRef.current = { kind: "restore" }
      }
      throw error
    } finally {
      if (restoreGenerationRef.current === generation) {
        restoreGenerationRef.current = null
      }
      if (isCurrent(generation, draftId, lifecycle)) setLoading(false)
    }
  }, [commitRelay, invalidatePending, isCurrent])

  const runPreview = useCallback(
    async (
      sourceConversationId: number,
      requestedScope?: RelayScopeSelection
    ) => {
      if (!allowedRef.current) return
      const current = latestRef.current
      const draftId = current.targetDraftId
      const lifecycle = lifecycleGenerationRef.current
      const selectedScope =
        requestedScope ?? relayRef.current?.scope ?? DEFAULT_SCOPE
      const generation = invalidatePending()
      const controller = new AbortController()
      previewAbortRef.current = controller
      retryOperationRef.current = null
      setLoading(true)
      try {
        const next = await previewRelayContext(
          {
            targetDraftId: draftId,
            sourceConversationId,
            targetFolderId: current.targetFolderId,
            targetAgentType: current.targetAgentType,
            targetModel: current.targetModel,
            scope: selectedScope,
          },
          controller.signal
        )
        if (isCurrent(generation, draftId, lifecycle)) {
          clearUndoTimer()
          localRemovalRef.current = null
          commitRelay(next)
        }
      } catch (error) {
        if (isCurrent(generation, draftId, lifecycle) && !isAbortError(error)) {
          retryOperationRef.current = {
            kind: "preview",
            sourceConversationId,
            scope: selectedScope,
          }
        }
        throw error
      } finally {
        if (isCurrent(generation, draftId, lifecycle)) {
          previewAbortRef.current = null
          setLoading(false)
        }
      }
    },
    [clearUndoTimer, commitRelay, invalidatePending, isCurrent]
  )

  const preview = useCallback(
    (sourceConversationId: number, scope?: RelayScopeSelection) =>
      runPreview(sourceConversationId, scope),
    [runPreview]
  )

  const updateScope = useCallback(
    async (scope: RelayScopeSelection) => {
      const currentRelay = relayRef.current
      if (
        !allowedRef.current ||
        !currentRelay ||
        currentRelay.status === "removed"
      ) {
        return
      }
      const current = latestRef.current
      const draftId = current.targetDraftId
      const lifecycle = lifecycleGenerationRef.current
      const generation = invalidatePending()
      retryOperationRef.current = null
      setLoading(true)
      try {
        const next = await updateRelayContext(currentRelay.id, {
          scope,
          targetAgentType: current.targetAgentType,
          targetModel: current.targetModel,
        })
        if (isCurrent(generation, draftId, lifecycle)) commitRelay(next)
      } catch (error) {
        if (isCurrent(generation, draftId, lifecycle)) {
          retryOperationRef.current = { kind: "update", scope }
          if (isBudgetExceeded(error)) {
            commitRelay({
              ...currentRelay,
              invalidReason: RELAY_BUDGET_EXCEEDED,
            })
            return
          }
        }
        throw error
      } finally {
        if (isCurrent(generation, draftId, lifecycle)) setLoading(false)
      }
    },
    [commitRelay, invalidatePending, isCurrent]
  )

  const scheduleUndoExpiry = useCallback(
    (removed: RelayContextPack) => {
      clearUndoTimer()
      undoTimerRef.current = setTimeout(() => {
        undoTimerRef.current = null
        if (
          mountedRef.current &&
          latestRef.current.targetDraftId === removed.targetDraftId &&
          relayRef.current?.id === removed.id &&
          relayRef.current.status === "removed"
        ) {
          commitRelay(null)
        }
        if (localRemovalRef.current?.relayId === removed.id) {
          localRemovalRef.current = null
        }
      }, UNDO_REMOVE_WINDOW_MS)
    },
    [clearUndoTimer, commitRelay]
  )

  const remove = useCallback(async () => {
    const currentRelay = relayRef.current
    if (!currentRelay || currentRelay.status === "removed") return
    const current = latestRef.current
    const draftId = current.targetDraftId
    const lifecycle = lifecycleGenerationRef.current
    const generation = invalidatePending()
    localRemovalRef.current = {
      relayId: currentRelay.id,
      targetDraftId: draftId,
    }
    retryOperationRef.current = null
    setLoading(true)
    try {
      const removed = await removeRelayContext(currentRelay.id)
      if (
        isCurrent(generation, draftId, lifecycle) &&
        relayRef.current?.id === currentRelay.id
      ) {
        commitRelay(removed)
        scheduleUndoExpiry(removed)
      }
    } catch (error) {
      if (
        localRemovalRef.current?.relayId === currentRelay.id &&
        localRemovalRef.current.targetDraftId === draftId
      ) {
        localRemovalRef.current = null
      }
      throw error
    } finally {
      if (isCurrent(generation, draftId, lifecycle)) setLoading(false)
    }
  }, [commitRelay, invalidatePending, isCurrent, scheduleUndoExpiry])

  const undoRemove = useCallback(async () => {
    const removed = relayRef.current
    if (!removed || removed.status !== "removed") return
    await runPreview(removed.sourceConversationId, removed.scope)
  }, [runPreview])

  const retry = useCallback(async () => {
    const operation = retryOperationRef.current
    if (operation?.kind === "restore") {
      await loadExisting()
      return
    }
    if (operation?.kind === "preview") {
      await runPreview(operation.sourceConversationId, operation.scope)
      return
    }
    if (operation?.kind === "update") {
      await updateScope(operation.scope)
      return
    }
    const currentRelay = relayRef.current
    if (currentRelay && currentRelay.status !== "removed") {
      await updateScope(currentRelay.scope)
    }
  }, [loadExisting, runPreview, updateScope])

  useEffect(() => {
    const lifecycle = ++lifecycleGenerationRef.current
    let disposed = false
    let subscriptionsPending = 2
    let reconnectBeforeReady = false
    const unsubscribers: Array<() => void> = []

    mountedRef.current = true
    subscriptionsReadyRef.current = false
    allowedRef.current = latestRef.current.enabled
    targetSignatureRef.current = targetSignature(
      latestRef.current.targetAgentType,
      latestRef.current.targetModel
    )
    configurationRefreshPendingRef.current = false
    invalidatePending()
    clearUndoTimer()
    localRemovalRef.current = null
    retryOperationRef.current = null
    commitRelay(null)
    setLoading(allowedRef.current)

    const finishSubscription = () => {
      subscriptionsPending -= 1
      if (
        subscriptionsPending !== 0 ||
        disposed ||
        lifecycleGenerationRef.current !== lifecycle
      ) {
        return
      }
      subscriptionsReadyRef.current = true
      if (allowedRef.current) {
        void loadExisting().catch(() => {})
      } else {
        setLoading(false)
      }
      if (reconnectBeforeReady && allowedRef.current) {
        void loadExisting().catch(() => {})
      }
    }

    const retainSubscription = (subscription: Promise<() => void>) => {
      void subscription
        .then((unsubscribe) => {
          if (disposed) unsubscribe()
          else unsubscribers.push(unsubscribe)
        })
        .catch(() => {})
        .finally(finishSubscription)
    }

    retainSubscription(
      subscribe<ConversationCapabilitySettings>(
        CONVERSATION_CAPABILITIES_CHANGED_EVENT,
        (settings) => {
          if (disposed || lifecycleGenerationRef.current !== lifecycle) return
          allowedRef.current = settings.relayEnabled
          if (!settings.relayEnabled) {
            invalidatePending()
            clearUndoTimer()
            localRemovalRef.current = null
            retryOperationRef.current = null
            commitRelay(null)
            setLoading(false)
          } else if (subscriptionsReadyRef.current) {
            void loadExisting().catch(() => {})
          }
        }
      )
    )

    retainSubscription(
      subscribe<ConversationRelayChange>(
        CONVERSATION_RELAY_CHANGED_EVENT,
        (change) => {
          if (
            disposed ||
            lifecycleGenerationRef.current !== lifecycle ||
            change.targetDraftId !== latestRef.current.targetDraftId
          ) {
            return
          }
          if (change.status === "removed") {
            if (
              localRemovalRef.current?.relayId === change.relayId &&
              localRemovalRef.current.targetDraftId === change.targetDraftId
            ) {
              return
            }
            if (relayRef.current && relayRef.current.id !== change.relayId) {
              if (
                restoreGenerationRef.current === operationGenerationRef.current
              ) {
                invalidatePending()
                restoreGenerationRef.current = null
                retryOperationRef.current = null
                setLoading(false)
              }
              return
            }
            invalidatePending()
            clearUndoTimer()
            localRemovalRef.current = null
            retryOperationRef.current = null
            commitRelay(null)
            setLoading(false)
            return
          }
          if (allowedRef.current && subscriptionsReadyRef.current) {
            void loadExisting().catch(() => {})
          }
        }
      )
    )

    const offReconnect = onTransportReconnect(() => {
      if (
        disposed ||
        lifecycleGenerationRef.current !== lifecycle ||
        !allowedRef.current
      ) {
        return
      }
      if (subscriptionsReadyRef.current) void loadExisting().catch(() => {})
      else reconnectBeforeReady = true
    })

    return () => {
      disposed = true
      if (lifecycleGenerationRef.current === lifecycle) {
        lifecycleGenerationRef.current += 1
      }
      mountedRef.current = false
      subscriptionsReadyRef.current = false
      invalidatePending()
      clearUndoTimer()
      localRemovalRef.current = null
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
      offReconnect?.()
    }
  }, [
    clearUndoTimer,
    commitRelay,
    invalidatePending,
    loadExisting,
    targetDraftId,
  ])

  useEffect(() => {
    allowedRef.current = enabled
    if (!enabled) {
      invalidatePending()
      clearUndoTimer()
      localRemovalRef.current = null
      retryOperationRef.current = null
      commitRelay(null)
      setLoading(false)
    } else if (subscriptionsReadyRef.current) {
      void loadExisting().catch(() => {})
    }
  }, [clearUndoTimer, commitRelay, enabled, invalidatePending, loadExisting])

  useEffect(() => {
    const signature = targetSignature(targetAgentType, targetModel)
    if (targetSignatureRef.current === null) {
      targetSignatureRef.current = signature
      return
    }
    if (targetSignatureRef.current !== signature) {
      targetSignatureRef.current = signature
      configurationRefreshPendingRef.current = true
    }
    const currentRelay = relayRef.current
    if (
      configurationRefreshPendingRef.current &&
      currentRelay &&
      currentRelay.status !== "removed"
    ) {
      configurationRefreshPendingRef.current = false
      void updateScope(currentRelay.scope).catch(() => {})
    }
  }, [relay, targetAgentType, targetModel, updateScope])

  return { relay, loading, preview, updateScope, remove, undoRemove, retry }
}

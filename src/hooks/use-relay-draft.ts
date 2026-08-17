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
const RELAY_CONSUME_CONFLICT = "relay_consume_conflict"
const DEFAULT_SCOPE: RelayScopeSelection = {
  scopeType: "recent_rounds",
  selectedRoundIds: [],
}

const RELAY_INVALID_REASONS = new Set([
  "relay_rounds_changed",
  "relay_model_changed",
  "relay_budget_exceeded",
  "relay_send_uncertain",
  "relay_source_not_found",
  "relay_source_unavailable",
])

interface RelayDraftOptions {
  targetDraftId: string
  targetConversationId?: number | null
  targetFolderId: number | null
  targetAgentType: AgentType
  targetModel: string | null
  enabled: boolean
  sendPending: boolean
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
  targetConversationId: number | null
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

function isRelayConsumeConflict(error: unknown): boolean {
  const appError = extractAppCommandError(error)
  if (
    appError?.code === RELAY_CONSUME_CONFLICT ||
    appError?.message === RELAY_CONSUME_CONFLICT
  ) {
    return true
  }
  return (
    error === RELAY_CONSUME_CONFLICT ||
    (error instanceof Error && error.message === RELAY_CONSUME_CONFLICT)
  )
}

function relayInvalidReason(error: unknown): string | null {
  const appError = extractAppCommandError(error)
  const candidates = [
    appError?.message,
    appError?.code,
    error instanceof Error ? error.message : null,
    typeof error === "string" ? error : null,
  ]
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && RELAY_INVALID_REASONS.has(candidate)
    ) ?? null
  )
}

function targetSignature(agentType: AgentType, model: string | null): string {
  return `${agentType}\u0000${model ?? ""}`
}

function normalizedTargetModel(model: string | null): string | null {
  const normalized = model?.trim()
  return normalized ? normalized : null
}

function scopeForRefresh(scope: RelayScopeSelection): RelayScopeSelection {
  return scope.scopeType === "custom_rounds"
    ? scope
    : { ...scope, selectedRoundIds: [] }
}

export function useRelayDraft({
  targetDraftId,
  targetConversationId = null,
  targetFolderId,
  targetAgentType,
  targetModel,
  enabled,
  sendPending,
}: RelayDraftOptions): {
  relay: RelayContextPack | null
  loading: boolean
  recoveryError: boolean
  preview: (
    sourceConversationId: number,
    scope?: RelayScopeSelection
  ) => Promise<void>
  updateScope: (scope: RelayScopeSelection) => Promise<void>
  remove: () => Promise<void>
  undoRemove: () => Promise<void>
  refresh: () => Promise<void>
  markSendFailure: (error: unknown) => void
  retry: () => Promise<void>
  clear: () => void
} {
  const [relay, setRelay] = useState<RelayContextPack | null>(null)
  const [loading, setLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState(false)
  const relayRef = useRef<RelayContextPack | null>(null)
  const latestRef = useRef({
    targetDraftId,
    targetConversationId,
    targetFolderId,
    targetAgentType,
    targetModel,
    enabled,
    sendPending,
  })
  latestRef.current = {
    targetDraftId,
    targetConversationId,
    targetFolderId,
    targetAgentType,
    targetModel,
    enabled,
    sendPending,
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

  const clear = useCallback(() => {
    invalidatePending()
    restoreGenerationRef.current = null
    retryOperationRef.current = null
    setLoading(false)
    setRecoveryError(false)
    commitRelay(null)
  }, [commitRelay, invalidatePending])

  const isCurrent = useCallback(
    (generation: number, draftId: string, lifecycle: number) =>
      mountedRef.current &&
      operationGenerationRef.current === generation &&
      lifecycleGenerationRef.current === lifecycle &&
      latestRef.current.targetDraftId === draftId,
    []
  )

  const matchesCurrentTarget = useCallback(
    (draftId: string, conversationId?: number | null) => {
      const current = latestRef.current
      return (
        draftId === current.targetDraftId ||
        (current.targetConversationId != null &&
          conversationId === current.targetConversationId)
      )
    },
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
      const existing = await getRelayContextByDraft(
        draftId,
        current.targetConversationId
      )
      if (isCurrent(generation, draftId, lifecycle)) {
        if (
          existing &&
          (existing.invalidReason === "relay_model_changed" ||
            normalizedTargetModel(existing.targetModel) !==
              normalizedTargetModel(latestRef.current.targetModel))
        ) {
          configurationRefreshPendingRef.current = true
        }
        const currentRelay = relayRef.current
        const keepInFlightRelay =
          existing === null &&
          current.sendPending &&
          currentRelay !== null &&
          matchesCurrentTarget(
            currentRelay.targetDraftId,
            currentRelay.targetConversationId
          )
        if (!keepInFlightRelay) commitRelay(existing)
        setRecoveryError(false)
      }
    } catch (error) {
      if (isCurrent(generation, draftId, lifecycle)) {
        retryOperationRef.current = { kind: "restore" }
        setRecoveryError(relayRef.current === null)
      }
      throw error
    } finally {
      if (restoreGenerationRef.current === generation) {
        restoreGenerationRef.current = null
      }
      if (isCurrent(generation, draftId, lifecycle)) setLoading(false)
    }
  }, [commitRelay, invalidatePending, isCurrent, matchesCurrentTarget])

  const runPreview = useCallback(
    async (
      sourceConversationId: number,
      requestedScope?: RelayScopeSelection
    ) => {
      if (!allowedRef.current) return
      const current = latestRef.current
      const draftId = current.targetDraftId
      const currentRelay = relayRef.current
      const previewTargetDraftId =
        currentRelay &&
        matchesCurrentTarget(
          currentRelay.targetDraftId,
          currentRelay.targetConversationId
        )
          ? currentRelay.targetDraftId
          : draftId
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
            targetDraftId: previewTargetDraftId,
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
          setRecoveryError(false)
        }
      } catch (error) {
        if (isCurrent(generation, draftId, lifecycle) && !isAbortError(error)) {
          retryOperationRef.current = {
            kind: "preview",
            sourceConversationId,
            scope: selectedScope,
          }
          setRecoveryError(relayRef.current === null)
        }
        throw error
      } finally {
        if (isCurrent(generation, draftId, lifecycle)) {
          previewAbortRef.current = null
          setLoading(false)
        }
      }
    },
    [
      clearUndoTimer,
      commitRelay,
      invalidatePending,
      isCurrent,
      matchesCurrentTarget,
    ]
  )

  const preview = useCallback(
    (sourceConversationId: number, scope?: RelayScopeSelection) =>
      runPreview(sourceConversationId, scope),
    [runPreview]
  )

  const refresh = useCallback(async () => {
    const currentRelay = relayRef.current
    if (!currentRelay || currentRelay.status === "removed") return
    try {
      await runPreview(
        currentRelay.sourceConversationId,
        scopeForRefresh(currentRelay.scope)
      )
    } catch (error) {
      const invalidReason = relayInvalidReason(error)
      if (invalidReason && relayRef.current?.id === currentRelay.id) {
        commitRelay({ ...currentRelay, invalidReason })
      }
      throw error
    }
  }, [commitRelay, runPreview])

  const markSendFailure = useCallback(
    (error: unknown) => {
      const invalidReason = relayInvalidReason(error)
      const currentRelay = relayRef.current
      if (
        !invalidReason ||
        !currentRelay ||
        currentRelay.status === "removed"
      ) {
        return
      }
      commitRelay({ ...currentRelay, status: "invalid", invalidReason })
    },
    [commitRelay]
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
      if (
        currentRelay.status !== "draft" ||
        currentRelay.invalidReason !== null
      ) {
        await runPreview(currentRelay.sourceConversationId, scope)
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
          if (isRelayConsumeConflict(error)) {
            await loadExisting()
            throw error
          }
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
    [commitRelay, invalidatePending, isCurrent, loadExisting, runPreview]
  )

  const scheduleUndoExpiry = useCallback(
    (removed: RelayContextPack) => {
      clearUndoTimer()
      undoTimerRef.current = setTimeout(() => {
        undoTimerRef.current = null
        if (
          mountedRef.current &&
          matchesCurrentTarget(
            removed.targetDraftId,
            removed.targetConversationId
          ) &&
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
    [clearUndoTimer, commitRelay, matchesCurrentTarget]
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
      targetDraftId: currentRelay.targetDraftId,
      targetConversationId: currentRelay.targetConversationId,
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
        matchesCurrentTarget(
          localRemovalRef.current.targetDraftId,
          localRemovalRef.current.targetConversationId
        )
      ) {
        localRemovalRef.current = null
      }
      throw error
    } finally {
      if (isCurrent(generation, draftId, lifecycle)) setLoading(false)
    }
  }, [
    commitRelay,
    invalidatePending,
    isCurrent,
    matchesCurrentTarget,
    scheduleUndoExpiry,
  ])

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
    const currentRelay = relayRef.current
    const keepInFlightRelay =
      latestRef.current.sendPending &&
      currentRelay !== null &&
      matchesCurrentTarget(
        currentRelay.targetDraftId,
        currentRelay.targetConversationId
      )
    if (!keepInFlightRelay) commitRelay(null)
    setLoading(allowedRef.current)
    setRecoveryError(false)

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
      const explicitPreviewInFlight = previewAbortRef.current !== null
      if (allowedRef.current) {
        if (!explicitPreviewInFlight) void loadExisting().catch(() => {})
      } else {
        setLoading(false)
      }
      if (
        reconnectBeforeReady &&
        allowedRef.current &&
        !explicitPreviewInFlight
      ) {
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
            setRecoveryError(false)
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
            !matchesCurrentTarget(
              change.targetDraftId,
              change.targetConversationId
            )
          ) {
            return
          }
          if (change.status === "removed") {
            if (
              localRemovalRef.current?.relayId === change.relayId &&
              matchesCurrentTarget(
                localRemovalRef.current.targetDraftId,
                localRemovalRef.current.targetConversationId
              )
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
            setRecoveryError(false)
            return
          }
          const currentRelay = relayRef.current
          const eventInvalidReason = change.errorCode
            ? relayInvalidReason(change.errorCode)
            : null
          if (
            currentRelay?.id === change.relayId &&
            eventInvalidReason !== null
          ) {
            invalidatePending()
            restoreGenerationRef.current = null
            retryOperationRef.current = null
            commitRelay({
              ...currentRelay,
              status: change.status,
              invalidReason: eventInvalidReason,
            })
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
    matchesCurrentTarget,
    targetConversationId,
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
      setRecoveryError(false)
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
      void refresh().catch(() => {})
    }
  }, [refresh, relay, targetAgentType, targetModel])

  return {
    relay,
    loading,
    recoveryError,
    preview,
    updateScope,
    remove,
    undoRemove,
    refresh,
    markSendFailure,
    retry,
    clear,
  }
}

import { extractAppCommandError } from "@/lib/app-error"
import type { PromptDraft } from "@/lib/types"

const RELAY_SEND_UNCERTAIN = "relay_send_uncertain"

function isUncertainRelaySendError(error: unknown): boolean {
  const appError = extractAppCommandError(error)
  if (
    appError?.code === RELAY_SEND_UNCERTAIN ||
    appError?.message === RELAY_SEND_UNCERTAIN
  ) {
    return true
  }
  if (appError?.code === "network_error") {
    const responseDetails = [appError.message, appError.detail]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
    // Axum rejects an oversized body before the relay handler can claim it.
    // Other transport/proxy failures can occur after the remote accepted it.
    return !/\bHTTP\s+413\b/i.test(responseDetails)
  }
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "NetworkError"
  ) {
    return true
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  return /^(Request timed out|Failed to fetch|Network request failed|Load failed)$/i.test(
    message.trim()
  )
}

export interface RelaySendBinding {
  relayId: number
  targetDraftId: string
}

export function resolveRelaySendBinding(
  relay: {
    id: number
    status: string
    invalidReason: string | null
    targetDraftId?: string
  } | null,
  targetDraftId?: string
): RelaySendBinding | null {
  if (
    !relay ||
    relay.invalidReason !== null ||
    (relay.status !== "draft" && relay.status !== "attached")
  ) {
    return null
  }
  const boundDraftId = relay.targetDraftId ?? targetDraftId
  if (!boundDraftId) return null
  return { relayId: relay.id, targetDraftId: boundDraftId }
}

export function shouldBlockRelaySend(
  relay: { id: number; status: string; invalidReason: string | null } | null,
  {
    loading,
    entryBlocked,
    recoveryError = false,
  }: {
    loading: boolean
    entryBlocked: boolean
    recoveryError?: boolean
    hasPersistedConversation: boolean
  }
): boolean {
  if (entryBlocked) return true
  if (recoveryError) return true
  if (loading) return true
  if (!relay || relay.status === "removed") return false
  return resolveRelaySendBinding(relay, "") === null
}

interface RelaySendAttemptOptions {
  binding: RelaySendBinding | null
  draft: PromptDraft
  getDraftStorageKey: () => string
  removeOptimisticTurn: () => void
  markOptimisticTurnUncertain: () => void
  setPending: (pending: boolean) => void
  saveDraft: (key: string, text: string) => void
  restoreDraft: (draft: PromptDraft) => void
  clearDraft: (key: string) => void
  clearRelay: () => void
  markRelayInvalid: (error: unknown) => void
  setQueuePaused: (paused: boolean) => void
}

export interface RelaySendAttempt {
  relayId?: number
  targetDraftId?: string
  onSendFailed: (error: unknown) => void
  onSendSucceeded?: () => void
}

export function createRelaySendAttempt({
  binding,
  draft,
  getDraftStorageKey,
  removeOptimisticTurn,
  markOptimisticTurnUncertain,
  setPending,
  saveDraft,
  restoreDraft,
  clearDraft,
  clearRelay,
  markRelayInvalid,
  setQueuePaused,
}: RelaySendAttemptOptions): RelaySendAttempt {
  const onSendFailed = (error: unknown) => {
    if (binding && isUncertainRelaySendError(error)) {
      markOptimisticTurnUncertain()
      markRelayInvalid(RELAY_SEND_UNCERTAIN)
      setPending(false)
      setQueuePaused(false)
      return
    }

    if (binding) setQueuePaused(true)
    removeOptimisticTurn()
    if (!binding) return

    markRelayInvalid(error)
    setPending(false)
    const restoredText = draft.displayText.trim()
    if (restoredText) {
      saveDraft(getDraftStorageKey(), restoredText)
    }

    restoreDraft(draft)
  }

  return {
    relayId: binding?.relayId,
    targetDraftId: binding?.targetDraftId,
    onSendFailed,
    onSendSucceeded: binding
      ? () => {
          setPending(false)
          setQueuePaused(false)
          clearDraft(getDraftStorageKey())
          clearRelay()
        }
      : undefined,
  }
}

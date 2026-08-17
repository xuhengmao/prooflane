import type { PromptDraft } from "@/lib/types"

export interface RelaySendBinding {
  relayId: number
  targetDraftId: string
}

export function resolveRelaySendBinding(
  relay: { id: number; status: string; invalidReason: string | null } | null,
  targetDraftId: string
): RelaySendBinding | null {
  if (
    !relay ||
    relay.invalidReason !== null ||
    (relay.status !== "draft" && relay.status !== "attached")
  ) {
    return null
  }
  return { relayId: relay.id, targetDraftId }
}

export function shouldBlockRelaySend(
  relay: { id: number; status: string; invalidReason: string | null } | null,
  {
    loading,
    entryBlocked,
    recoveryError = false,
    hasPersistedConversation,
  }: {
    loading: boolean
    entryBlocked: boolean
    recoveryError?: boolean
    hasPersistedConversation: boolean
  }
): boolean {
  if (entryBlocked) return true
  if (recoveryError) return true
  if (loading && (relay !== null || !hasPersistedConversation)) return true
  if (!relay || relay.status === "removed") return false
  return resolveRelaySendBinding(relay, "") === null
}

interface RelaySendAttemptOptions {
  binding: RelaySendBinding | null
  draft: PromptDraft
  getDraftStorageKey: () => string
  removeOptimisticTurn: () => void
  setPending: (pending: boolean) => void
  saveDraft: (key: string, text: string) => void
  restoreDraft: (draft: PromptDraft) => void
  clearDraft: (key: string) => void
  clearRelay: () => void
  markRelayInvalid: (error: unknown) => void
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
  setPending,
  saveDraft,
  restoreDraft,
  clearDraft,
  clearRelay,
  markRelayInvalid,
}: RelaySendAttemptOptions): RelaySendAttempt {
  const onSendFailed = (error: unknown) => {
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
          clearDraft(getDraftStorageKey())
          clearRelay()
        }
      : undefined,
  }
}

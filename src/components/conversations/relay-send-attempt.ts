export interface RelaySendBinding {
  relayId: number
  targetDraftId: string
}

interface RelaySendAttemptOptions {
  binding: RelaySendBinding | null
  draftText: string
  getDraftStorageKey: () => string
  removeOptimisticTurn: () => void
  setPending: (pending: boolean) => void
  saveDraft: (key: string, text: string) => void
  restoreComposer: () => void
  clearDraft: (key: string) => void
  clearRelay: () => void
}

export interface RelaySendAttempt {
  relayId?: number
  targetDraftId?: string
  onSendFailed: (error: unknown) => void
  onSendSucceeded?: () => void
}

export function createRelaySendAttempt({
  binding,
  draftText,
  getDraftStorageKey,
  removeOptimisticTurn,
  setPending,
  saveDraft,
  restoreComposer,
  clearDraft,
  clearRelay,
}: RelaySendAttemptOptions): RelaySendAttempt {
  const onSendFailed = () => {
    removeOptimisticTurn()
    if (!binding) return

    setPending(false)
    const restoredText = draftText.trim()
    if (!restoredText) return

    saveDraft(getDraftStorageKey(), restoredText)
    restoreComposer()
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

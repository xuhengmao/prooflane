import {
  createRelaySendAttempt,
  type RelaySendBinding,
} from "./relay-send-attempt"

describe("relay send attempt", () => {
  it("restores a failed attempt without auto retry and keeps relay data for manual retry", () => {
    let binding: RelaySendBinding | null = {
      relayId: 7,
      targetDraftId: "draft-1",
    }
    const dispatch = vi.fn()
    const removeOptimisticTurn = vi.fn()
    const setPending = vi.fn()
    const saveDraft = vi.fn()
    const restoreComposer = vi.fn()
    const clearDraft = vi.fn()
    const clearRelay = vi.fn(() => {
      binding = null
    })
    const createAttempt = () =>
      createRelaySendAttempt({
        binding,
        draftText: "  finish the relay  ",
        getDraftStorageKey: () => "conversation:42",
        removeOptimisticTurn,
        setPending,
        saveDraft,
        restoreComposer,
        clearDraft,
        clearRelay,
      })

    const first = createAttempt()
    dispatch(first)
    first.onSendFailed(new Error("network down"))

    expect(removeOptimisticTurn).toHaveBeenCalledOnce()
    expect(setPending).toHaveBeenLastCalledWith(false)
    expect(saveDraft).toHaveBeenCalledWith(
      "conversation:42",
      "finish the relay"
    )
    expect(restoreComposer).toHaveBeenCalledOnce()
    expect(clearRelay).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledOnce()

    const retry = createAttempt()
    dispatch(retry)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(retry.relayId).toBe(7)
    expect(retry.targetDraftId).toBe("draft-1")

    retry.onSendSucceeded?.()
    expect(clearDraft).toHaveBeenCalledWith("conversation:42")
    expect(clearRelay).toHaveBeenCalledOnce()
    expect(binding).toBeNull()
  })
})

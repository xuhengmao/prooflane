import {
  createRelaySendAttempt,
  resolveRelaySendBinding,
  shouldBlockRelaySend,
  type RelaySendBinding,
} from "./relay-send-attempt"
import type { PromptDraft } from "@/lib/types"

describe("relay send attempt", () => {
  it("blocks loading and invalid relay state without blocking ordinary persisted sends", () => {
    const validRelay = { id: 10, status: "draft", invalidReason: null }
    const invalidRelay = {
      id: 11,
      status: "invalid",
      invalidReason: "relay_rounds_changed",
    }

    expect(
      shouldBlockRelaySend(null, {
        loading: true,
        entryBlocked: false,
        hasPersistedConversation: false,
      })
    ).toBe(true)
    expect(
      shouldBlockRelaySend(null, {
        loading: true,
        entryBlocked: false,
        hasPersistedConversation: true,
      })
    ).toBe(false)
    expect(
      shouldBlockRelaySend(validRelay, {
        loading: true,
        entryBlocked: false,
        hasPersistedConversation: false,
      })
    ).toBe(true)
    expect(
      shouldBlockRelaySend(invalidRelay, {
        loading: false,
        entryBlocked: false,
        hasPersistedConversation: true,
      })
    ).toBe(true)
    expect(
      shouldBlockRelaySend(
        { id: 12, status: "removed", invalidReason: null },
        {
          loading: false,
          entryBlocked: false,
          hasPersistedConversation: true,
        }
      )
    ).toBe(false)
    expect(
      shouldBlockRelaySend(null, {
        loading: false,
        entryBlocked: true,
        recoveryError: false,
        hasPersistedConversation: false,
      })
    ).toBe(true)
    expect(
      shouldBlockRelaySend(null, {
        loading: false,
        entryBlocked: false,
        recoveryError: true,
        hasPersistedConversation: false,
      })
    ).toBe(true)
  })

  it("does not bind a relay that is only retained for undo after removal", () => {
    expect(
      resolveRelaySendBinding(
        { id: 7, status: "removed", invalidReason: null },
        "draft-1"
      )
    ).toBeNull()
    expect(
      resolveRelaySendBinding(
        { id: 8, status: "invalid", invalidReason: "relay_rounds_changed" },
        "draft-1"
      )
    ).toBeNull()
    expect(
      resolveRelaySendBinding(
        {
          id: 9,
          status: "attached",
          invalidReason: "relay_model_changed",
        },
        "draft-1"
      )
    ).toBeNull()
    expect(
      resolveRelaySendBinding(
        { id: 10, status: "draft", invalidReason: null },
        "draft-1"
      )
    ).toEqual({ relayId: 10, targetDraftId: "draft-1" })
  })

  it("restores a failed attempt without auto retry and keeps relay data for manual retry", () => {
    let binding: RelaySendBinding | null = {
      relayId: 7,
      targetDraftId: "draft-1",
    }
    const dispatch = vi.fn()
    const removeOptimisticTurn = vi.fn()
    const setPending = vi.fn()
    const saveDraft = vi.fn()
    const restoreDraft = vi.fn()
    const clearDraft = vi.fn()
    const clearRelay = vi.fn(() => {
      binding = null
    })
    const markRelayInvalid = vi.fn()
    const draft: PromptDraft = {
      blocks: [{ type: "text", text: "finish the relay" }],
      displayText: "  finish the relay  ",
    }
    const createAttempt = () =>
      createRelaySendAttempt({
        binding,
        draft,
        getDraftStorageKey: () => "conversation:42",
        removeOptimisticTurn,
        setPending,
        saveDraft,
        restoreDraft,
        clearDraft,
        clearRelay,
        markRelayInvalid,
      })

    const first = createAttempt()
    dispatch(first)
    const failure = new Error("network down")
    first.onSendFailed(failure)

    expect(removeOptimisticTurn).toHaveBeenCalledOnce()
    expect(setPending).toHaveBeenLastCalledWith(false)
    expect(saveDraft).toHaveBeenCalledWith(
      "conversation:42",
      "finish the relay"
    )
    expect(restoreDraft).toHaveBeenCalledWith(draft)
    expect(clearRelay).not.toHaveBeenCalled()
    expect(markRelayInvalid).toHaveBeenCalledWith(failure)
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

  it("restores every prompt block when an attachment-only attempt fails", () => {
    const draft: PromptDraft = {
      displayText: "",
      blocks: [
        {
          type: "image",
          data: "BASE64_IMAGE",
          mime_type: "image/png",
          uri: null,
        },
        {
          type: "resource_link",
          uri: "file:///repo/spec.pdf",
          name: "spec.pdf",
          mime_type: "application/pdf",
          description: null,
        },
      ],
    }
    const restoreDraft = vi.fn()
    const attempt = createRelaySendAttempt({
      binding: { relayId: 12, targetDraftId: "draft-attachments" },
      draft,
      getDraftStorageKey: () => "conversation:52",
      removeOptimisticTurn: vi.fn(),
      setPending: vi.fn(),
      saveDraft: vi.fn(),
      restoreDraft,
      clearDraft: vi.fn(),
      clearRelay: vi.fn(),
      markRelayInvalid: vi.fn(),
    })

    attempt.onSendFailed(new Error("network down"))

    expect(restoreDraft).toHaveBeenCalledWith(draft)
  })
})

import {
  createRelaySendAttempt,
  resolveRelaySendBinding,
  shouldBlockRelaySend,
  type RelaySendBinding,
} from "./relay-send-attempt"
import type { PromptDraft } from "@/lib/types"

describe("relay send attempt", () => {
  it("blocks every relay recovery until the target binding has been checked", () => {
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
    ).toBe(true)
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
        {
          id: 10,
          status: "attached",
          invalidReason: null,
          targetDraftId: "new-original-tab",
        },
        "conv-91"
      )
    ).toEqual({ relayId: 10, targetDraftId: "new-original-tab" })
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
    const setQueuePaused = vi.fn()
    const draft: PromptDraft = {
      blocks: [{ type: "text", text: "finish the relay" }],
      displayText: "  finish the relay  ",
    }
    const createAttempt = () => {
      const options = {
        binding,
        draft,
        getDraftStorageKey: () => "conversation:42",
        removeOptimisticTurn,
        markOptimisticTurnUncertain: vi.fn(),
        setPending,
        saveDraft,
        restoreDraft,
        clearDraft,
        clearRelay,
        markRelayInvalid,
        setQueuePaused,
      }
      return createRelaySendAttempt(options)
    }

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
    expect(setQueuePaused).toHaveBeenLastCalledWith(true)
    expect(dispatch).toHaveBeenCalledOnce()

    const retry = createAttempt()
    dispatch(retry)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(retry.relayId).toBe(7)
    expect(retry.targetDraftId).toBe("draft-1")

    retry.onSendSucceeded?.()
    expect(clearDraft).toHaveBeenCalledWith("conversation:42")
    expect(clearRelay).toHaveBeenCalledOnce()
    expect(setQueuePaused).toHaveBeenLastCalledWith(false)
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
      markOptimisticTurnUncertain: vi.fn(),
      setPending: vi.fn(),
      saveDraft: vi.fn(),
      restoreDraft,
      clearDraft: vi.fn(),
      clearRelay: vi.fn(),
      markRelayInvalid: vi.fn(),
      setQueuePaused: vi.fn(),
    })

    attempt.onSendFailed(new Error("network down"))

    expect(restoreDraft).toHaveBeenCalledWith(draft)
  })

  it.each([
    [
      "后端返回结果未知",
      { code: "invalid_input", message: "relay_send_uncertain" },
    ],
    [
      "远程桌面连接中断",
      {
        code: "network_error",
        message: "Remote HTTP request failed",
        detail: "connection reset by peer",
      },
    ],
    [
      "远程桌面响应读取失败",
      {
        code: "network_error",
        message: "Failed to parse remote response",
        detail: "connection closed before message completed",
      },
    ],
    [
      "结构化网络中断",
      { code: "network_error", message: "connection interrupted" },
    ],
    [
      "远端 HTTP 500",
      {
        code: "network_error",
        message: "Remote returned HTTP 500 Internal Server Error",
      },
    ],
    ["Web 请求超时", new Error("Request timed out")],
    ["浏览器网络中断", new TypeError("Failed to fetch")],
  ])("%s 时保留乐观消息且不恢复为可重复发送草稿", (_label, error) => {
    const removeOptimisticTurn = vi.fn()
    const setPending = vi.fn()
    const saveDraft = vi.fn()
    const restoreDraft = vi.fn()
    const clearDraft = vi.fn()
    const clearRelay = vi.fn()
    const markRelayInvalid = vi.fn()
    const markOptimisticTurnUncertain = vi.fn()
    const setQueuePaused = vi.fn()
    const attempt = createRelaySendAttempt({
      binding: { relayId: 15, targetDraftId: "draft-uncertain" },
      draft: {
        blocks: [{ type: "text", text: "continue uncertain task" }],
        displayText: "continue uncertain task",
      },
      getDraftStorageKey: () => "conversation:uncertain",
      removeOptimisticTurn,
      markOptimisticTurnUncertain,
      setPending,
      saveDraft,
      restoreDraft,
      clearDraft,
      clearRelay,
      markRelayInvalid,
      setQueuePaused,
    })

    attempt.onSendFailed(error)

    expect(removeOptimisticTurn).not.toHaveBeenCalled()
    expect(markOptimisticTurnUncertain).toHaveBeenCalledOnce()
    expect(saveDraft).not.toHaveBeenCalled()
    expect(restoreDraft).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
    expect(clearRelay).not.toHaveBeenCalled()
    expect(setPending).toHaveBeenCalledWith(false)
    expect(setQueuePaused).toHaveBeenCalledWith(false)
    expect(markRelayInvalid).toHaveBeenCalledWith("relay_send_uncertain")
  })

  it.each([
    ["明确的 HTTP 413", { code: "network_error", message: "HTTP 413" }],
    [
      "远端明确返回的 HTTP 413",
      {
        code: "network_error",
        message: "Remote returned HTTP 413 Payload Too Large",
      },
    ],
    ["普通 TypeError", new TypeError("Cannot read properties of undefined")],
  ])("%s 会回滚并恢复草稿", (_label, error) => {
    const removeOptimisticTurn = vi.fn()
    const markOptimisticTurnUncertain = vi.fn()
    const saveDraft = vi.fn()
    const restoreDraft = vi.fn()
    const setQueuePaused = vi.fn()
    const options = {
      binding: { relayId: 16, targetDraftId: "draft-definitive" },
      draft: {
        blocks: [{ type: "text" as const, text: "retry this prompt" }],
        displayText: "retry this prompt",
      },
      getDraftStorageKey: () => "conversation:definitive",
      removeOptimisticTurn,
      markOptimisticTurnUncertain,
      setPending: vi.fn(),
      saveDraft,
      restoreDraft,
      clearDraft: vi.fn(),
      clearRelay: vi.fn(),
      markRelayInvalid: vi.fn(),
      setQueuePaused,
    }

    createRelaySendAttempt(options).onSendFailed(error)

    expect(removeOptimisticTurn).toHaveBeenCalledOnce()
    expect(markOptimisticTurnUncertain).not.toHaveBeenCalled()
    expect(saveDraft).toHaveBeenCalledWith(
      "conversation:definitive",
      "retry this prompt"
    )
    expect(restoreDraft).toHaveBeenCalledWith(options.draft)
    expect(setQueuePaused).toHaveBeenCalledWith(true)
  })

  it("人工重试由确定失败转为结果未知时解除旧队列暂停", () => {
    let queuePaused = false
    const setQueuePaused = vi.fn((paused: boolean) => {
      queuePaused = paused
    })
    const options = {
      binding: { relayId: 17, targetDraftId: "draft-retry-uncertain" },
      draft: {
        blocks: [{ type: "text" as const, text: "retry relay" }],
        displayText: "retry relay",
      },
      getDraftStorageKey: () => "conversation:retry-uncertain",
      removeOptimisticTurn: vi.fn(),
      markOptimisticTurnUncertain: vi.fn(),
      setPending: vi.fn(),
      saveDraft: vi.fn(),
      restoreDraft: vi.fn(),
      clearDraft: vi.fn(),
      clearRelay: vi.fn(),
      markRelayInvalid: vi.fn(),
      setQueuePaused,
    }

    createRelaySendAttempt(options).onSendFailed(new Error("network down"))
    expect(queuePaused).toBe(true)

    createRelaySendAttempt(options).onSendFailed(
      new TypeError("Failed to fetch")
    )
    expect(queuePaused).toBe(false)
    expect(setQueuePaused).toHaveBeenLastCalledWith(false)
  })

  it("没有接力绑定时仍按普通失败回滚网络错误", () => {
    const removeOptimisticTurn = vi.fn()
    const restoreDraft = vi.fn()
    const attempt = createRelaySendAttempt({
      binding: null,
      draft: {
        blocks: [{ type: "text", text: "ordinary prompt" }],
        displayText: "ordinary prompt",
      },
      getDraftStorageKey: () => "conversation:ordinary",
      removeOptimisticTurn,
      markOptimisticTurnUncertain: vi.fn(),
      setPending: vi.fn(),
      saveDraft: vi.fn(),
      restoreDraft,
      clearDraft: vi.fn(),
      clearRelay: vi.fn(),
      markRelayInvalid: vi.fn(),
      setQueuePaused: vi.fn(),
    })

    attempt.onSendFailed(new TypeError("Failed to fetch"))

    expect(removeOptimisticTurn).toHaveBeenCalledOnce()
    expect(restoreDraft).not.toHaveBeenCalled()
  })
})

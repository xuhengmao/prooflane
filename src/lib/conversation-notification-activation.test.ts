import { describe, expect, it, vi } from "vitest"
import {
  activateConversationNotification,
  installConversationNotificationActivationListeners,
  isConversationNotificationActivationPayload,
} from "./conversation-notification-activation"
import { CONVERSATION_NOTIFICATION_ACTIVATED_EVENT } from "./conversation-notification"
import type { DbConversationSummary } from "./types"

function summary(
  overrides: Partial<DbConversationSummary> = {}
): DbConversationSummary {
  return {
    id: 42,
    folder_id: 7,
    title: "Build review",
    title_locked: false,
    agent_type: "codex",
    status: "completed",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: "session-42",
    message_count: 3,
    child_count: 0,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    pinned_at: null,
    ...overrides,
  }
}

const payload = {
  conversationId: 42,
  runId: "turn-1",
  notificationType: "completed" as const,
  messageId: "assistant-1",
}

function dependencies(initial: DbConversationSummary[]) {
  let conversations = initial
  return {
    getConversations: vi.fn(() => conversations),
    refreshConversations: vi.fn(async () => undefined),
    openConversation: vi.fn(),
    requestLocation: vi.fn(),
    markClicked: vi.fn(async () => ({ updated: true })),
    reportMissing: vi.fn(),
    replaceConversations(next: DbConversationSummary[]) {
      conversations = next
    },
  }
}

describe("activateConversationNotification", () => {
  it("opens the exact loaded conversation, requests its anchor, and marks the receipt", async () => {
    const deps = dependencies([summary()])

    await expect(activateConversationNotification(payload, deps)).resolves.toBe(
      "opened"
    )

    expect(deps.refreshConversations).not.toHaveBeenCalled()
    expect(deps.openConversation).toHaveBeenCalledWith({
      folderId: 7,
      conversationId: 42,
      agentType: "codex",
      title: "Build review",
    })
    expect(deps.requestLocation).toHaveBeenCalledWith({
      conversationId: 42,
      messageId: "assistant-1",
    })
    expect(deps.markClicked).toHaveBeenCalledWith(payload)
  })

  it("refreshes summaries once when the target has not loaded yet", async () => {
    const deps = dependencies([])
    deps.refreshConversations.mockImplementation(async () => {
      deps.replaceConversations([summary()])
    })

    await expect(activateConversationNotification(payload, deps)).resolves.toBe(
      "opened"
    )

    expect(deps.refreshConversations).toHaveBeenCalledTimes(1)
    expect(deps.openConversation).toHaveBeenCalledTimes(1)
  })

  it("reports a deleted conversation explicitly and still clears its receipt", async () => {
    const deps = dependencies([])

    await expect(activateConversationNotification(payload, deps)).resolves.toBe(
      "missing"
    )

    expect(deps.refreshConversations).toHaveBeenCalledTimes(1)
    expect(deps.openConversation).not.toHaveBeenCalled()
    expect(deps.requestLocation).not.toHaveBeenCalled()
    expect(deps.reportMissing).toHaveBeenCalledWith(42)
    expect(deps.markClicked).toHaveBeenCalledWith(payload)
  })

  it("still clears the receipt when navigation fails and preserves that error", async () => {
    const deps = dependencies([summary()])
    const navigationError = new Error("tab store unavailable")
    deps.openConversation.mockImplementation(() => {
      throw navigationError
    })

    await expect(activateConversationNotification(payload, deps)).rejects.toBe(
      navigationError
    )

    expect(deps.markClicked).toHaveBeenCalledWith(payload)
    expect(deps.requestLocation).not.toHaveBeenCalled()
  })
})

describe("conversation notification activation payload", () => {
  it("accepts only a complete validated payload", () => {
    expect(isConversationNotificationActivationPayload(payload)).toBe(true)
    expect(
      isConversationNotificationActivationPayload({
        ...payload,
        conversationId: 0,
      })
    ).toBe(false)
    expect(
      isConversationNotificationActivationPayload({
        ...payload,
        notificationType: "unknown",
      })
    ).toBe(false)
    expect(
      isConversationNotificationActivationPayload({
        ...payload,
        messageId: 5,
      })
    ).toBe(false)
  })
})

describe("installConversationNotificationActivationListeners", () => {
  it("routes browser custom events and removes the listener", () => {
    const target = new EventTarget()
    const onActivation = vi.fn()
    const cleanup = installConversationNotificationActivationListeners({
      target,
      desktop: false,
      subscribeShell: vi.fn(),
      onActivation,
    })

    target.dispatchEvent(
      new CustomEvent(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, {
        detail: payload,
      })
    )
    expect(onActivation).toHaveBeenCalledWith(payload)

    cleanup()
    target.dispatchEvent(
      new CustomEvent(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, {
        detail: payload,
      })
    )
    expect(onActivation).toHaveBeenCalledTimes(1)
  })

  it("subscribes to the local shell on desktop and handles async cleanup", async () => {
    let shellHandler: ((value: unknown) => void) | undefined
    let resolveSubscription: ((unlisten: () => void) => void) | undefined
    const unlisten = vi.fn()
    const subscribeShell = vi.fn(
      (_event: string, handler: (value: unknown) => void) => {
        shellHandler = handler
        return new Promise<() => void>((resolve) => {
          resolveSubscription = resolve
        })
      }
    )
    const onActivation = vi.fn()
    const cleanup = installConversationNotificationActivationListeners({
      target: new EventTarget(),
      desktop: true,
      subscribeShell,
      onActivation,
    })

    expect(subscribeShell).toHaveBeenCalledWith(
      CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
      expect.any(Function)
    )
    shellHandler?.(payload)
    expect(onActivation).toHaveBeenCalledWith(payload)

    cleanup()
    resolveSubscription?.(unlisten)
    await Promise.resolve()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it("handles a rejected desktop subscription without an unhandled promise", async () => {
    const error = new Error("shell unavailable")
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const cleanup = installConversationNotificationActivationListeners({
        target: new EventTarget(),
        desktop: true,
        subscribeShell: vi.fn(async () => {
          throw error
        }),
        onActivation: vi.fn(),
      })

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "[conversation-notification] activation subscription failed:",
          error
        )
      })

      expect(cleanup).not.toThrow()
    } finally {
      consoleError.mockRestore()
    }
  })
})

import { describe, expect, it } from "vitest"

import {
  createConversationNotificationCoordinator,
  type ConversationNotificationClaim,
  type ConversationNotificationCopy,
  type ConversationNotificationDelivery,
  type ConversationNotificationRequest,
  type ConversationNotificationReceiptKey,
  type ConversationNotificationState,
  type NativeConversationNotification,
} from "./conversation-notification"

const REQUEST: ConversationNotificationRequest = {
  conversationId: 42,
  runId: "run-42",
  notificationType: "completed",
  messageId: "message-42",
  conversationTitle: "Build release",
}

const COPY: ConversationNotificationCopy = {
  completed: {
    title: "Conversation completed",
    status: "has generated a response. Click to view.",
  },
  failed: {
    title: "Conversation failed",
    status: "could not finish. Click to view.",
  },
  action_required: {
    title: "Conversation needs your action",
    status: "is waiting for confirmation. Click to continue.",
  },
}

interface HarnessOptions {
  enabled?: boolean
  state?: ConversationNotificationState
  claimed?: boolean
  sendResult?: ConversationNotificationDelivery
  sendError?: Error
}

function createHarness(options: HarnessOptions = {}) {
  const calls = {
    states: 0,
    claims: [] as ConversationNotificationClaim[],
    releases: [] as ConversationNotificationReceiptKey[],
    notifications: [] as NativeConversationNotification[],
  }
  const coordinator = createConversationNotificationCoordinator({
    isEnabled: () => options.enabled ?? true,
    getState: async () => {
      calls.states += 1
      return (
        options.state ?? {
          appFocused: false,
          permission: "granted",
        }
      )
    },
    claim: async (claim) => {
      calls.claims.push(claim)
      return { claimed: options.claimed ?? true }
    },
    release: async (claim) => {
      calls.releases.push(claim)
      return { released: true }
    },
    send: async (notification) => {
      calls.notifications.push(notification)
      if (options.sendError) throw options.sendError
      return options.sendResult ?? { sent: true }
    },
  })

  return { coordinator, calls }
}

describe("conversation notification coordinator", () => {
  it("does not inspect state or claim a receipt when the device switch is off", async () => {
    const { coordinator, calls } = createHarness({ enabled: false })

    const result = await coordinator.notify(REQUEST, COPY)

    expect(result).toEqual({ status: "disabled" })
    expect(calls).toEqual({
      states: 0,
      claims: [],
      releases: [],
      notifications: [],
    })
  })

  it("does not claim a receipt while any Prooflane window is focused", async () => {
    const { coordinator, calls } = createHarness({
      state: { appFocused: true, permission: "granted" },
    })

    const result = await coordinator.notify(REQUEST, COPY)

    expect(result).toEqual({ status: "foreground" })
    expect(calls.claims).toEqual([])
    expect(calls.notifications).toEqual([])
  })

  it.each(["denied", "prompt", "unsupported"] as const)(
    "does not claim while notification permission is %s",
    async (permission) => {
      const { coordinator, calls } = createHarness({
        state: { appFocused: false, permission },
      })

      const result = await coordinator.notify(REQUEST, COPY)

      expect(result).toEqual({ status: `permission_${permission}` })
      expect(calls.claims).toEqual([])
      expect(calls.notifications).toEqual([])
    }
  )

  it("does not display a duplicate receipt", async () => {
    const { coordinator, calls } = createHarness({ claimed: false })

    const result = await coordinator.notify(REQUEST, COPY)

    expect(result).toEqual({ status: "duplicate" })
    expect(calls.claims).toEqual([
      {
        conversationId: 42,
        runId: "run-42",
        notificationType: "completed",
        messageId: "message-42",
      },
    ])
    expect(calls.notifications).toEqual([])
  })

  it("displays one fixed safe notification with a structured activation payload", async () => {
    const { coordinator, calls } = createHarness()
    const requestWithSensitiveExtras = {
      ...REQUEST,
      replyText: "API token sk-secret must never leave the app",
      errorDetails: "C:/private/customer/report.txt",
    } as ConversationNotificationRequest

    const result = await coordinator.notify(requestWithSensitiveExtras, COPY)

    expect(result).toEqual({ status: "sent" })
    expect(calls.notifications).toEqual([
      {
        title: "Conversation completed",
        body: '"Build release" has generated a response. Click to view.',
        activationPayload: {
          conversationId: 42,
          runId: "run-42",
          notificationType: "completed",
          messageId: "message-42",
        },
      },
    ])
    expect(JSON.stringify(calls.notifications)).not.toContain("sk-secret")
    expect(JSON.stringify(calls.notifications)).not.toContain("C:/private")
  })

  it("releases the receipt when the native shell detects a focused window", async () => {
    const { coordinator, calls } = createHarness({
      sendResult: { sent: false, reason: "foreground" },
    })

    const result = await coordinator.notify(REQUEST, COPY)

    expect(result).toEqual({ status: "foreground" })
    expect(calls.releases).toEqual([
      {
        conversationId: 42,
        runId: "run-42",
        notificationType: "completed",
      },
    ])
  })

  it("releases the receipt when notification delivery throws", async () => {
    const { coordinator, calls } = createHarness({
      sendError: new Error("toast service unavailable"),
    })

    const result = await coordinator.notify(REQUEST, COPY)

    expect(result).toEqual({ status: "failed" })
    expect(calls.releases).toHaveLength(1)
  })
})

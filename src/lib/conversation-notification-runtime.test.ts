import { describe, expect, it } from "vitest"

import {
  createConversationNotificationRuntime,
  type ConversationNotificationRuntimeDependencies,
} from "./conversation-notification-runtime"
import type {
  ConversationNotificationCopy,
  ConversationNotificationRequest,
  NativeConversationNotification,
} from "./conversation-notification"

const REQUEST: ConversationNotificationRequest = {
  conversationId: 42,
  runId: "run-42",
  notificationType: "completed",
  messageId: "message-42",
  conversationTitle: "Build release",
}

const COPY: ConversationNotificationCopy = {
  completed: { title: "Completed", status: "is ready." },
  failed: { title: "Failed", status: "could not finish." },
  action_required: { title: "Action required", status: "needs approval." },
}

interface RuntimeHarnessOptions {
  desktop: boolean
}

function createRuntimeHarness({ desktop }: RuntimeHarnessOptions) {
  const receiptCalls: Array<{
    command: string
    args?: Record<string, unknown>
  }> = []
  const shellCalls: Array<{
    command: string
    args?: Record<string, unknown>
  }> = []
  const browser = {
    states: 0,
    permissionRequests: 0,
    notifications: [] as NativeConversationNotification[],
  }

  const deps: ConversationNotificationRuntimeDependencies = {
    isDesktop: () => desktop,
    isEnabled: () => true,
    receiptCall: async <T>(
      command: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      receiptCalls.push({ command, args })
      if (command === "claim_conversation_notification") {
        return { claimed: true } as T
      }
      if (command === "release_conversation_notification") {
        return { released: true } as T
      }
      if (command === "mark_conversation_notification_clicked") {
        return { updated: true } as T
      }
      throw new Error(`unexpected receipt command: ${command}`)
    },
    shellCall: async <T>(
      command: string,
      args?: Record<string, unknown>
    ): Promise<T> => {
      shellCalls.push({ command, args })
      if (command === "get_conversation_notification_state") {
        return { appFocused: false, permission: "granted" } as T
      }
      if (command === "send_conversation_notification") {
        return { sent: true } as T
      }
      if (command === "request_conversation_notification_permission") {
        return { permission: "granted" } as T
      }
      if (command === "open_conversation_notification_settings") {
        return undefined as T
      }
      throw new Error(`unexpected shell command: ${command}`)
    },
    getBrowserState: async () => {
      browser.states += 1
      return { appFocused: false, permission: "granted" }
    },
    requestBrowserPermission: async () => {
      browser.permissionRequests += 1
      return { permission: "granted" }
    },
    sendBrowser: async (notification) => {
      browser.notifications.push(notification)
      return { sent: true }
    },
  }

  return {
    runtime: createConversationNotificationRuntime(deps),
    receiptCalls,
    shellCalls,
    browser,
  }
}

describe("conversation notification runtime routing", () => {
  it("uses the active backend for receipts and the local shell for desktop delivery", async () => {
    const { runtime, receiptCalls, shellCalls, browser } = createRuntimeHarness(
      { desktop: true }
    )

    await expect(runtime.notify(REQUEST, COPY)).resolves.toEqual({
      status: "sent",
    })

    expect(receiptCalls).toEqual([
      {
        command: "claim_conversation_notification",
        args: {
          conversationId: 42,
          runId: "run-42",
          notificationType: "completed",
          messageId: "message-42",
        },
      },
    ])
    expect(shellCalls).toEqual([
      { command: "get_conversation_notification_state", args: undefined },
      {
        command: "send_conversation_notification",
        args: {
          title: "Completed",
          body: '"Build release" is ready.',
          activationPayload: {
            conversationId: 42,
            runId: "run-42",
            notificationType: "completed",
            messageId: "message-42",
          },
        },
      },
    ])
    expect(browser).toEqual({
      states: 0,
      permissionRequests: 0,
      notifications: [],
    })
  })

  it("uses browser state and delivery without calling the desktop shell", async () => {
    const { runtime, receiptCalls, shellCalls, browser } = createRuntimeHarness(
      { desktop: false }
    )

    await expect(runtime.notify(REQUEST, COPY)).resolves.toEqual({
      status: "sent",
    })

    expect(receiptCalls).toHaveLength(1)
    expect(shellCalls).toEqual([])
    expect(browser.states).toBe(1)
    expect(browser.notifications).toHaveLength(1)
  })

  it("requests permission on the correct local surface", async () => {
    const desktop = createRuntimeHarness({ desktop: true })
    const web = createRuntimeHarness({ desktop: false })

    await desktop.runtime.requestPermission()
    await web.runtime.requestPermission()

    expect(desktop.shellCalls).toEqual([
      {
        command: "request_conversation_notification_permission",
        args: undefined,
      },
    ])
    expect(desktop.browser.permissionRequests).toBe(0)
    expect(web.shellCalls).toEqual([])
    expect(web.browser.permissionRequests).toBe(1)
  })

  it("marks a click on the receipt backend and opens desktop settings locally", async () => {
    const { runtime, receiptCalls, shellCalls } = createRuntimeHarness({
      desktop: true,
    })

    await expect(runtime.markClicked(REQUEST)).resolves.toEqual({
      updated: true,
    })
    await expect(runtime.openSettings()).resolves.toBe(true)

    expect(receiptCalls).toEqual([
      {
        command: "mark_conversation_notification_clicked",
        args: {
          conversationId: 42,
          runId: "run-42",
          notificationType: "completed",
        },
      },
    ])
    expect(shellCalls).toEqual([
      {
        command: "open_conversation_notification_settings",
        args: undefined,
      },
    ])
  })

  it("reports that browser notification settings cannot be opened programmatically", async () => {
    const { runtime, shellCalls } = createRuntimeHarness({ desktop: false })

    await expect(runtime.openSettings()).resolves.toBe(false)
    expect(shellCalls).toEqual([])
  })
})

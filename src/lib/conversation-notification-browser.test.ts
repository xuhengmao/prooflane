import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
  getBrowserConversationNotificationState,
  requestBrowserConversationNotificationPermission,
  sendBrowserConversationNotification,
  type ConversationNotificationActivationPayload,
  type NativeConversationNotification,
} from "./conversation-notification"

const originalNotification = globalThis.Notification
const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState"
)

const ACTIVATION_PAYLOAD: ConversationNotificationActivationPayload = {
  conversationId: 42,
  runId: "run-42",
  notificationType: "completed",
  messageId: "message-42",
}

const NOTIFICATION: NativeConversationNotification = {
  title: "Conversation completed",
  body: '"Build release" has generated a response. Click to view.',
  activationPayload: ACTIVATION_PAYLOAD,
}

class FakeNotification {
  static permission: NotificationPermission = "granted"
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>()
  static instances: FakeNotification[] = []

  readonly title: string
  readonly options?: NotificationOptions
  onclick: ((event: Event) => void) | null = null
  closed = false

  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options
    FakeNotification.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

function installNotification(permission: NotificationPermission) {
  FakeNotification.permission = permission
  FakeNotification.requestPermission.mockReset()
  FakeNotification.instances = []
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    writable: true,
    value: FakeNotification,
  })
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
}

describe("browser conversation notification shell", () => {
  beforeEach(() => {
    installNotification("granted")
    setVisibility("hidden")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalNotification) {
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        writable: true,
        value: originalNotification,
      })
    } else {
      Reflect.deleteProperty(globalThis, "Notification")
    }
    if (originalVisibilityState) {
      Object.defineProperty(
        document,
        "visibilityState",
        originalVisibilityState
      )
    }
  })

  it("reports unsupported without trying to request permission", async () => {
    Reflect.deleteProperty(globalThis, "Notification")

    await expect(getBrowserConversationNotificationState()).resolves.toEqual({
      appFocused: false,
      permission: "unsupported",
    })
  })

  it("maps default permission to prompt without opening an authorization UI", async () => {
    installNotification("default")

    await expect(getBrowserConversationNotificationState()).resolves.toEqual({
      appFocused: false,
      permission: "prompt",
    })
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
  })

  it("treats a visible focused page as foreground", async () => {
    setVisibility("visible")
    vi.spyOn(document, "hasFocus").mockReturnValue(true)

    await expect(getBrowserConversationNotificationState()).resolves.toEqual({
      appFocused: true,
      permission: "granted",
    })
  })

  it("requests permission only through the explicit user-action function", async () => {
    installNotification("default")
    FakeNotification.requestPermission.mockResolvedValue("granted")

    await expect(
      requestBrowserConversationNotificationPermission()
    ).resolves.toEqual({ permission: "granted" })
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("rechecks foreground immediately before displaying", async () => {
    setVisibility("visible")
    vi.spyOn(document, "hasFocus").mockReturnValue(true)

    await expect(
      sendBrowserConversationNotification(NOTIFICATION)
    ).resolves.toEqual({ sent: false, reason: "foreground" })
    expect(FakeNotification.instances).toEqual([])
  })

  it("returns permission_denied instead of displaying", async () => {
    installNotification("denied")

    await expect(
      sendBrowserConversationNotification(NOTIFICATION)
    ).resolves.toEqual({ sent: false, reason: "permission_denied" })
    expect(FakeNotification.instances).toEqual([])
  })

  it("focuses the page and emits the structured activation payload on click", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {})
    const activations: ConversationNotificationActivationPayload[] = []
    window.addEventListener(
      CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
      ((event: CustomEvent<ConversationNotificationActivationPayload>) => {
        activations.push(event.detail)
      }) as EventListener,
      { once: true }
    )

    await expect(
      sendBrowserConversationNotification(NOTIFICATION)
    ).resolves.toEqual({ sent: true })
    const displayed = FakeNotification.instances[0]
    expect(displayed?.title).toBe("Conversation completed")
    expect(displayed?.options).toEqual({ body: NOTIFICATION.body })

    displayed?.onclick?.(new Event("click"))

    expect(focus).toHaveBeenCalledTimes(1)
    expect(activations).toEqual([ACTIVATION_PAYLOAD])
    expect(displayed?.closed).toBe(true)
  })
})

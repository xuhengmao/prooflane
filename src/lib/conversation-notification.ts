export const CONVERSATION_NOTIFICATION_TYPES = [
  "completed",
  "failed",
  "action_required",
] as const

export type ConversationNotificationType =
  (typeof CONVERSATION_NOTIFICATION_TYPES)[number]

export type ConversationNotificationPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported"

export interface ConversationNotificationState {
  appFocused: boolean
  permission: ConversationNotificationPermission
}

export interface ConversationNotificationReceiptKey {
  conversationId: number
  runId: string
  notificationType: ConversationNotificationType
}

export interface ConversationNotificationClaim extends ConversationNotificationReceiptKey {
  messageId: string | null
}

export interface ConversationNotificationRequest extends ConversationNotificationClaim {
  conversationTitle: string
}

export type ConversationNotificationActivationPayload =
  ConversationNotificationClaim

export interface ConversationNotificationCopyItem {
  title: string
  status: string
}

export type ConversationNotificationCopy = Record<
  ConversationNotificationType,
  ConversationNotificationCopyItem
>

export interface NativeConversationNotification {
  title: string
  body: string
  activationPayload: ConversationNotificationActivationPayload
}

export type ConversationNotificationDelivery =
  | { sent: true }
  | {
      sent: false
      reason:
        | "foreground"
        | "permission_denied"
        | "permission_prompt"
        | "unsupported"
    }

export type ConversationNotificationResult =
  | { status: "disabled" }
  | { status: "foreground" }
  | { status: "permission_denied" }
  | { status: "permission_prompt" }
  | { status: "permission_unsupported" }
  | { status: "duplicate" }
  | { status: "sent" }
  | { status: "failed" }

export interface ConversationNotificationCoordinatorDeps {
  isEnabled(): boolean
  getState(): Promise<ConversationNotificationState>
  claim(claim: ConversationNotificationClaim): Promise<{ claimed: boolean }>
  release(
    key: ConversationNotificationReceiptKey
  ): Promise<{ released: boolean }>
  send(
    notification: NativeConversationNotification
  ): Promise<ConversationNotificationDelivery>
}

export const CONVERSATION_NOTIFICATION_ACTIVATED_EVENT =
  "notification://activated"

function browserPermission(): ConversationNotificationPermission {
  if (typeof Notification === "undefined") return "unsupported"
  switch (Notification.permission) {
    case "granted":
      return "granted"
    case "denied":
      return "denied"
    case "default":
    default:
      return "prompt"
  }
}

function browserPageFocused(): boolean {
  if (typeof document === "undefined") return false
  return document.visibilityState === "visible" && document.hasFocus()
}

export async function getBrowserConversationNotificationState(): Promise<ConversationNotificationState> {
  return {
    appFocused: browserPageFocused(),
    permission: browserPermission(),
  }
}

export async function requestBrowserConversationNotificationPermission(): Promise<{
  permission: ConversationNotificationPermission
}> {
  const current = browserPermission()
  if (current !== "prompt") return { permission: current }

  try {
    const permission = await Notification.requestPermission()
    return {
      permission: permission === "default" ? "prompt" : permission,
    }
  } catch {
    return { permission: browserPermission() }
  }
}

export async function sendBrowserConversationNotification(
  notification: NativeConversationNotification
): Promise<ConversationNotificationDelivery> {
  if (browserPageFocused()) return { sent: false, reason: "foreground" }

  const permission = browserPermission()
  if (permission !== "granted") {
    return {
      sent: false,
      reason:
        permission === "denied"
          ? "permission_denied"
          : permission === "prompt"
            ? "permission_prompt"
            : "unsupported",
    }
  }

  const displayed = new Notification(notification.title, {
    body: notification.body,
  })
  displayed.onclick = () => {
    try {
      window.focus()
    } catch {
      // Some browsers disallow programmatic focus; activation still proceeds.
    }
    window.dispatchEvent(
      new CustomEvent(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, {
        detail: notification.activationPayload,
      })
    )
    displayed.close()
  }

  return { sent: true }
}

function receiptKey(
  request: ConversationNotificationRequest
): ConversationNotificationReceiptKey {
  return {
    conversationId: request.conversationId,
    runId: request.runId,
    notificationType: request.notificationType,
  }
}

function claimPayload(
  request: ConversationNotificationRequest
): ConversationNotificationClaim {
  return {
    ...receiptKey(request),
    messageId: request.messageId,
  }
}

function safeConversationTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim()
  return (normalized || "Conversation").slice(0, 120)
}

function deliveryStatus(
  reason: Exclude<ConversationNotificationDelivery, { sent: true }>["reason"]
): ConversationNotificationResult {
  switch (reason) {
    case "foreground":
      return { status: "foreground" }
    case "permission_denied":
      return { status: "permission_denied" }
    case "permission_prompt":
      return { status: "permission_prompt" }
    case "unsupported":
      return { status: "permission_unsupported" }
  }
}

async function releaseQuietly(
  deps: ConversationNotificationCoordinatorDeps,
  key: ConversationNotificationReceiptKey
): Promise<void> {
  try {
    await deps.release(key)
  } catch {
    // A later duplicate remains safer than displaying the same receipt twice.
  }
}

export function createConversationNotificationCoordinator(
  deps: ConversationNotificationCoordinatorDeps
) {
  return {
    async notify(
      request: ConversationNotificationRequest,
      copy: ConversationNotificationCopy
    ): Promise<ConversationNotificationResult> {
      if (!deps.isEnabled()) return { status: "disabled" }

      let state: ConversationNotificationState
      try {
        state = await deps.getState()
      } catch {
        return { status: "failed" }
      }

      if (state.appFocused) return { status: "foreground" }
      if (state.permission !== "granted") {
        return { status: `permission_${state.permission}` }
      }

      const claim = claimPayload(request)
      try {
        const result = await deps.claim(claim)
        if (!result.claimed) return { status: "duplicate" }
      } catch {
        return { status: "failed" }
      }

      const key = receiptKey(request)
      const content = copy[request.notificationType]
      const notification: NativeConversationNotification = {
        title: content.title,
        body: `"${safeConversationTitle(request.conversationTitle)}" ${content.status}`,
        activationPayload: claim,
      }

      try {
        const delivery = await deps.send(notification)
        if (delivery.sent) return { status: "sent" }

        await releaseQuietly(deps, key)
        return deliveryStatus(delivery.reason)
      } catch {
        await releaseQuietly(deps, key)
        return { status: "failed" }
      }
    },
  }
}

import {
  CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
  CONVERSATION_NOTIFICATION_TYPES,
  type ConversationNotificationActivationPayload,
} from "./conversation-notification"
import type { AgentType, DbConversationSummary } from "./types"

export interface ConversationNotificationActivationDependencies {
  getConversations(): DbConversationSummary[]
  refreshConversations(): Promise<void>
  openConversation(target: {
    folderId: number
    conversationId: number
    agentType: AgentType
    title: string | null
  }): void
  requestLocation(target: {
    conversationId: number
    messageId: string | null
  }): void
  markClicked(
    payload: ConversationNotificationActivationPayload
  ): Promise<{ updated: boolean }>
  reportMissing(conversationId: number): void
}

export type ConversationNotificationActivationResult = "opened" | "missing"

function findConversation(
  conversations: DbConversationSummary[],
  conversationId: number
): DbConversationSummary | null {
  return conversations.find((item) => item.id === conversationId) ?? null
}

export async function activateConversationNotification(
  payload: ConversationNotificationActivationPayload,
  deps: ConversationNotificationActivationDependencies
): Promise<ConversationNotificationActivationResult> {
  let result: ConversationNotificationActivationResult
  try {
    let conversation = findConversation(
      deps.getConversations(),
      payload.conversationId
    )

    if (!conversation) {
      await deps.refreshConversations()
      conversation = findConversation(
        deps.getConversations(),
        payload.conversationId
      )
    }

    if (!conversation) {
      deps.reportMissing(payload.conversationId)
      result = "missing"
    } else {
      deps.openConversation({
        folderId: conversation.folder_id,
        conversationId: conversation.id,
        agentType: conversation.agent_type,
        title: conversation.title,
      })
      deps.requestLocation({
        conversationId: conversation.id,
        messageId: payload.messageId,
      })
      result = "opened"
    }
  } catch (error) {
    try {
      await deps.markClicked(payload)
    } catch {
      // Preserve the navigation error that explains the visible failure.
    }
    throw error
  }

  await deps.markClicked(payload)
  return result
}

export function isConversationNotificationActivationPayload(
  value: unknown
): value is ConversationNotificationActivationPayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.conversationId === "number" &&
    Number.isSafeInteger(payload.conversationId) &&
    payload.conversationId > 0 &&
    typeof payload.runId === "string" &&
    payload.runId.trim().length > 0 &&
    CONVERSATION_NOTIFICATION_TYPES.includes(
      payload.notificationType as (typeof CONVERSATION_NOTIFICATION_TYPES)[number]
    ) &&
    (payload.messageId === null || typeof payload.messageId === "string")
  )
}

interface ConversationNotificationActivationListenerOptions {
  target: EventTarget
  desktop: boolean
  subscribeShell(
    event: string,
    handler: (payload: unknown) => void
  ): Promise<() => void>
  onActivation(payload: ConversationNotificationActivationPayload): void
}

export function installConversationNotificationActivationListeners({
  target,
  desktop,
  subscribeShell,
  onActivation,
}: ConversationNotificationActivationListenerOptions): () => void {
  let disposed = false
  let unlistenShell: (() => void) | null = null

  const route = (value: unknown) => {
    if (isConversationNotificationActivationPayload(value)) {
      onActivation(value)
    }
  }
  const onBrowserActivation = (event: Event) => {
    route((event as CustomEvent<unknown>).detail)
  }

  target.addEventListener(
    CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
    onBrowserActivation
  )

  if (desktop) {
    void subscribeShell(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, route)
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlistenShell = unlisten
      })
      .catch((error) => {
        console.error(
          "[conversation-notification] activation subscription failed:",
          error
        )
      })
  }

  return () => {
    disposed = true
    target.removeEventListener(
      CONVERSATION_NOTIFICATION_ACTIVATED_EVENT,
      onBrowserActivation
    )
    unlistenShell?.()
    unlistenShell = null
  }
}

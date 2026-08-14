import type { ConversationNotificationRequest } from "./conversation-notification"
import type { ConnectionStatus, EventEnvelope } from "./types"

export interface ConversationNotificationEventSource {
  envelope: EventEnvelope
  conversationId: number | null
  conversationTitle: string
  connectionStatus: ConnectionStatus
  pendingUserMessageId: string | null
  liveMessageId: string | null
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function runIdForEvent(source: ConversationNotificationEventSource): string {
  return (
    nonEmpty(source.pendingUserMessageId) ??
    nonEmpty(source.liveMessageId) ??
    `${source.envelope.connection_id}:${source.envelope.seq}`
  )
}

function requestForType(
  source: ConversationNotificationEventSource,
  notificationType: ConversationNotificationRequest["notificationType"]
): ConversationNotificationRequest {
  return {
    conversationId: source.conversationId as number,
    runId: runIdForEvent(source),
    notificationType,
    messageId: nonEmpty(source.liveMessageId),
    conversationTitle: source.conversationTitle,
  }
}

export function buildConversationNotificationRequests(
  source: ConversationNotificationEventSource
): ConversationNotificationRequest[] {
  if (source.conversationId == null || source.conversationId <= 0) return []

  const event = source.envelope
  switch (event.type) {
    case "turn_complete":
      return event.stop_reason === "end_turn"
        ? [requestForType(source, "completed")]
        : []
    case "error":
      return source.connectionStatus === "prompting"
        ? [requestForType(source, "failed")]
        : []
    case "permission_request":
      return [requestForType(source, "action_required")]
    case "background_activity":
      return (event.settled ?? []).map((settled, index) => ({
        conversationId: source.conversationId as number,
        runId:
          nonEmpty(settled.task_id) ??
          `${event.connection_id}:${event.seq}:background:${index}`,
        notificationType:
          settled.status === "completed" ? "completed" : "failed",
        messageId: nonEmpty(settled.tool_use_id),
        conversationTitle: source.conversationTitle,
      }))
    default:
      return []
  }
}

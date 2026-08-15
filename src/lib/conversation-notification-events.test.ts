import { describe, expect, it } from "vitest"

import { buildConversationNotificationRequests } from "./conversation-notification-events"
import type { EventEnvelope } from "./types"

type WithoutRouting<T> = T extends EventEnvelope
  ? Omit<T, "seq" | "connection_id">
  : never

function envelope(payload: WithoutRouting<EventEnvelope>): EventEnvelope {
  return {
    seq: 17,
    connection_id: "connection-7",
    ...payload,
  } as EventEnvelope
}

const BASE_SOURCE = {
  conversationId: 42,
  conversationTitle: "Build release",
  connectionStatus: "prompting" as const,
  pendingUserMessageId: "user-message-42",
  liveMessageId: "assistant-message-42",
}

describe("ACP conversation notification mapping", () => {
  it("maps a normal turn end and prefers the user message as its run id", () => {
    const requests = buildConversationNotificationRequests({
      ...BASE_SOURCE,
      envelope: envelope({
        type: "turn_complete",
        session_id: "session-1",
        stop_reason: "end_turn",
      }),
    })

    expect(requests).toEqual([
      {
        conversationId: 42,
        runId: "user-message-42",
        notificationType: "completed",
        messageId: "assistant-message-42",
        conversationTitle: "Build release",
      },
    ])
  })

  it("does not call a cancelled or failed stop reason completed", () => {
    for (const stopReason of ["cancelled", "error", "refusal"]) {
      expect(
        buildConversationNotificationRequests({
          ...BASE_SOURCE,
          envelope: envelope({
            type: "turn_complete",
            session_id: "session-1",
            stop_reason: stopReason,
          }),
        })
      ).toEqual([])
    }
  })

  it("maps an error only while a user-initiated turn is active", () => {
    const error = envelope({
      type: "error",
      message: "C:/private/error details",
      agent_type: "codex",
      code: "process_exited",
    })

    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        envelope: error,
      })
    ).toEqual([
      {
        conversationId: 42,
        runId: "user-message-42",
        notificationType: "failed",
        messageId: "assistant-message-42",
        conversationTitle: "Build release",
      },
    ])
    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        connectionStatus: "connected",
        envelope: error,
      })
    ).toEqual([])
  })

  it("maps permission requests to action_required", () => {
    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        envelope: envelope({
          type: "permission_request",
          request_id: "permission-1",
          tool_call: { rawInput: "secret must not escape" },
          options: [],
        }),
      })
    ).toEqual([
      {
        conversationId: 42,
        runId: "user-message-42",
        notificationType: "action_required",
        messageId: "assistant-message-42",
        conversationTitle: "Build release",
      },
    ])
  })

  it("falls back from user message to live message and then connection sequence", () => {
    const event = envelope({
      type: "permission_request",
      request_id: "permission-1",
      tool_call: {},
      options: [],
    })

    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        pendingUserMessageId: null,
        envelope: event,
      })[0]?.runId
    ).toBe("assistant-message-42")
    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        pendingUserMessageId: null,
        liveMessageId: null,
        envelope: event,
      })[0]?.runId
    ).toBe("connection-7:17")
  })

  it("uses task ids for background settlements without forwarding their content", () => {
    const requests = buildConversationNotificationRequests({
      ...BASE_SOURCE,
      connectionStatus: "connected",
      envelope: envelope({
        type: "background_activity",
        session_id: "session-1",
        outstanding: 0,
        watermark: 9,
        settled: [
          {
            task_id: "task-complete",
            status: "completed",
            summary: "secret completion summary",
            result: "C:/private/result.txt",
            tool_use_id: "tool-1",
          },
          {
            task_id: "task-failed",
            status: "failed",
            summary: "secret failure summary",
          },
        ],
      }),
    })

    expect(requests).toEqual([
      {
        conversationId: 42,
        runId: "task-complete",
        notificationType: "completed",
        messageId: "tool-1",
        conversationTitle: "Build release",
      },
      {
        conversationId: 42,
        runId: "task-failed",
        notificationType: "failed",
        messageId: null,
        conversationTitle: "Build release",
      },
    ])
    expect(JSON.stringify(requests)).not.toContain("secret")
    expect(JSON.stringify(requests)).not.toContain("C:/private")
  })

  it("skips events that cannot be tied to a persisted conversation", () => {
    expect(
      buildConversationNotificationRequests({
        ...BASE_SOURCE,
        conversationId: null,
        envelope: envelope({
          type: "permission_request",
          request_id: "permission-1",
          tool_call: {},
          options: [],
        }),
      })
    ).toEqual([])
  })
})

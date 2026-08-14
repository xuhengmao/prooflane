import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationNotificationActivationBridge } from "./conversation-notification-activation-bridge"
import { CONVERSATION_NOTIFICATION_ACTIVATED_EVENT } from "@/lib/conversation-notification"
import type { DbConversationSummary } from "@/lib/types"

const h = vi.hoisted(() => ({
  conversations: [] as DbConversationSummary[],
  refreshConversations: vi.fn(async () => undefined),
  openTab: vi.fn(),
  openConversations: vi.fn(),
  requestLocation: vi.fn(),
  markClicked: vi.fn(async () => ({ updated: true })),
  pushAlert: vi.fn(),
  shellSubscribe: vi.fn(async () => () => {}),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({ pushAlert: h.pushAlert }),
}))

vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: h.openConversations }),
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: {
    getState: () => ({
      conversations: h.conversations,
      refreshConversations: h.refreshConversations,
    }),
  },
}))

vi.mock("@/stores/tab-store", () => ({
  useTabStore: {
    getState: () => ({ openTab: h.openTab }),
  },
}))

vi.mock("@/lib/conversation-notification-location", () => ({
  requestConversationNotificationLocation: h.requestLocation,
}))

vi.mock("@/lib/conversation-notification-runtime", () => ({
  conversationNotificationRuntime: {
    markClicked: h.markClicked,
  },
}))

vi.mock("@/lib/transport", () => ({
  isDesktop: () => false,
  getShellTransport: () => ({ subscribe: h.shellSubscribe }),
}))

const conversation: DbConversationSummary = {
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
}

const payload = {
  conversationId: 42,
  runId: "turn-1",
  notificationType: "completed" as const,
  messageId: "assistant-1",
}

describe("ConversationNotificationActivationBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.conversations = [conversation]
  })

  it("opens the conversation route and exact pinned tab from a browser activation", async () => {
    render(<ConversationNotificationActivationBridge />)

    window.dispatchEvent(
      new CustomEvent(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, {
        detail: payload,
      })
    )

    await waitFor(() => expect(h.markClicked).toHaveBeenCalledWith(payload))
    expect(h.openConversations).toHaveBeenCalledTimes(1)
    expect(h.openTab).toHaveBeenCalledWith(7, 42, "codex", true, "Build review")
    expect(h.requestLocation).toHaveBeenCalledWith({
      conversationId: 42,
      messageId: "assistant-1",
    })
  })

  it("surfaces an explicit error when the refreshed conversation is gone", async () => {
    h.conversations = []
    render(<ConversationNotificationActivationBridge />)

    window.dispatchEvent(
      new CustomEvent(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, {
        detail: payload,
      })
    )

    await waitFor(() => expect(h.refreshConversations).toHaveBeenCalledTimes(1))
    expect(h.openTab).not.toHaveBeenCalled()
    expect(h.pushAlert).toHaveBeenCalledWith(
      "error",
      "activation.missingTitle",
      'activation.missingDetail:{"id":42}'
    )
    expect(h.markClicked).toHaveBeenCalledWith(payload)
  })
})

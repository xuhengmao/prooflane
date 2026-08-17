import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { RelayContextPack } from "@/lib/types"
import { RelayPreviewDrawer } from "./relay-preview-drawer"
import { renderWithRelayIntl } from "./relay-test-utils"

const relay: RelayContextPack = {
  id: 7,
  targetDraftId: "draft-7",
  targetConversationId: null,
  sourceConversationId: 42,
  sourceFolderId: 1,
  scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
  snapshot: {
    version: 1,
    source: { conversationId: 42, folderId: 1 },
    scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
    availableRounds: [],
    includedRounds: [
      {
        id: "round-1",
        userText: "杭州今天的天气怎么样？",
        assistantText: "杭州今天晴到多云，最高 32°C。",
        tools: [
          {
            toolUseId: "weather-1",
            name: "weather_lookup",
            input: '{"city":"杭州"}',
            output: '{"temperature":32}',
            isError: false,
          },
        ],
        files: [],
        sourceMessageIds: ["message-1", "message-2"],
      },
    ],
    summary: null,
    files: [
      {
        path: "C:/work/weather-report.md",
        mimeType: "text/markdown",
        sourceMessageId: "message-2",
      },
    ],
    stats: { messageCount: 2, fileCount: 1, todoCount: 0 },
    canonicalContext:
      '<prooflane-relay-context>{"internal":"不要直接展示"}</prooflane-relay-context>',
  },
  sourceFingerprint: "fingerprint",
  estimatedTokens: 1280,
  contextWindowTokens: 200000,
  targetModel: null,
  allowedTokens: 12000,
  status: "draft",
  invalidReason: null,
  createdAt: "2026-08-16T00:00:00Z",
  updatedAt: "2026-08-16T00:00:00Z",
  consumedAt: null,
}

describe("RelayPreviewDrawer", () => {
  it("renders a readable conversation preview without exposing the internal protocol", async () => {
    const user = userEvent.setup()
    renderWithRelayIntl(
      <RelayPreviewDrawer
        open
        onOpenChange={vi.fn()}
        relay={relay}
        sourceTitle="天气查询"
      />
    )

    expect(screen.getByText("天气查询")).toBeInTheDocument()
    expect(screen.getByText("你")).toBeInTheDocument()
    expect(screen.getByText("杭州今天的天气怎么样？")).toBeInTheDocument()
    expect(screen.getByText("AI")).toBeInTheDocument()
    expect(
      screen.getByText("杭州今天晴到多云，最高 32°C。")
    ).toBeInTheDocument()
    const tools = screen.getByRole("group", { name: "工具调用 1" })
    expect(tools).not.toHaveAttribute("open")
    await user.click(screen.getByText("工具调用 1"))
    expect(screen.getByText("输入")).toBeInTheDocument()
    expect(screen.getByText('{"city":"杭州"}')).toBeInTheDocument()
    expect(screen.getByText("输出")).toBeInTheDocument()
    expect(screen.getByText('{"temperature":32}')).toBeInTheDocument()
    expect(screen.getByText("C:/work/weather-report.md")).toBeInTheDocument()
    expect(screen.getByText("1,280 / 12,000")).toBeInTheDocument()
    expect(
      screen.queryByText(/prooflane-relay-context/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/不要直接展示/)).not.toBeInTheDocument()
  })
})

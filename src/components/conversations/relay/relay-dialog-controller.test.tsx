import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { RelayContextPack } from "@/lib/types"
import { RelayDialogController } from "./relay-dialog-controller"

const rounds = [
  {
    id: "round-1",
    userText: "需求是什么",
    assistantText: "需求结论",
    tools: [],
    files: [],
    sourceMessageIds: ["message-1"],
  },
]

const relay = {
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
    availableRounds: rounds,
    includedRounds: rounds,
    summary: null,
    files: [],
    stats: { messageCount: 2, fileCount: 0, todoCount: 0 },
    canonicalContext: "context",
  },
  sourceFingerprint: "fingerprint",
  estimatedTokens: 12,
  contextWindowTokens: 200000,
  allowedTokens: 12000,
  status: "draft",
  invalidReason: null,
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-15T00:00:00Z",
  consumedAt: null,
} satisfies RelayContextPack

function controllerProps(
  overrides: Partial<React.ComponentProps<typeof RelayDialogController>> = {}
) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    conversations: [
      { id: 42, folder_id: 1, title: "产品需求讨论", agent_type: "codex" },
    ],
    folders: [{ id: 1, name: "Prooflane" }],
    currentFolderId: 1,
    relay: null,
    loading: false,
    previewOpen: false,
    onPreviewOpenChange: vi.fn(),
    onPreview: vi.fn().mockResolvedValue(undefined),
    onUpdateScope: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("RelayDialogController", () => {
  it("keeps a failed initial preview visible and offers retry", async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn().mockRejectedValue(new Error("source unavailable"))
    render(<RelayDialogController {...controllerProps({ onPreview })} />)

    await user.click(screen.getByText("产品需求讨论"))

    expect(
      await screen.findByText("接力上下文准备失败，请重试")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(onPreview).toHaveBeenCalledTimes(2)
  })

  it("shows summary loading and preserves an actionable error", async () => {
    const user = userEvent.setup()
    let rejectUpdate: (error: Error) => void = () => {}
    const onUpdateScope = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectUpdate = reject
        })
    )
    render(
      <RelayDialogController {...controllerProps({ relay, onUpdateScope })} />
    )

    await user.click(screen.getByRole("button", { name: "摘要" }))
    expect(screen.getByText("正在生成摘要")).toBeInTheDocument()

    await act(async () => rejectUpdate(new Error("summary unavailable")))
    expect(screen.getByText("摘要暂不可用")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "最近 10 轮" })).toBeEnabled()
  })
})

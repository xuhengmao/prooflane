import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { RelayProvenance } from "@/lib/types"
import { RelayProvenanceItem } from "./relay-provenance"
import { renderWithRelayIntl } from "./relay-test-utils"

const provenance: RelayProvenance = {
  relayId: 7,
  snapshotSha256: "a".repeat(64),
  source: { conversationId: 11, folderId: 2, title: "产品需求讨论" },
  scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
  summary: {
    goals: ["完成认证模块"],
    decisions: [],
    progress: [],
    todos: ["补充刷新流程"],
    constraints: [],
    files: ["src/auth.ts"],
    openQuestions: [],
  },
  includedRounds: [
    {
      id: "round-1",
      userText: "实现登录",
      assistantText: "登录表单已完成",
      tools: [],
      files: [],
      sourceMessageIds: ["message-1"],
    },
  ],
  files: [
    {
      path: "src/auth.ts",
      mimeType: "text/typescript",
      sourceMessageId: "message-1",
    },
  ],
  stats: { messageCount: 2, fileCount: 1, todoCount: 1 },
  consumedAt: "2026-08-15T08:00:00Z",
}

describe("RelayProvenanceItem", () => {
  it("renders a compact source row and opens immutable details", () => {
    renderWithRelayIntl(<RelayProvenanceItem provenance={provenance} />)

    const trigger = screen.getByRole("button", {
      name: /已接续.*产品需求讨论/,
    })
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByText("完成认证模块")).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(screen.getByRole("dialog", { name: "接力来源" })).toBeInTheDocument()
    expect(screen.getByText("完成认证模块")).toBeInTheDocument()
    expect(screen.getByText("实现登录")).toBeInTheDocument()
    expect(screen.getByText("src/auth.ts")).toBeInTheDocument()
    expect(screen.queryByText(/canonicalContext/)).not.toBeInTheDocument()
  })

  it("uses the active locale when the source title is no longer available", () => {
    renderWithRelayIntl(
      <RelayProvenanceItem
        provenance={{
          ...provenance,
          source: { ...provenance.source, title: "" },
        }}
      />
    )

    expect(
      screen.getByRole("button", { name: /已接续.*会话 #11/ })
    ).toBeInTheDocument()
  })
})

import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RelayContextCard } from "./relay-context-card"
import { renderWithRelayIntl } from "./relay-test-utils"

describe("RelayContextCard", () => {
  it("发送接力上下文期间禁止调整或移除", () => {
    const onPreview = vi.fn()
    const onAdjust = vi.fn()
    const onRemove = vi.fn()
    renderWithRelayIntl(
      <RelayContextCard
        disabled
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: null,
          status: "attached",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={onPreview}
        onAdjust={onAdjust}
        onRemove={onRemove}
        onUndo={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByRole("button", { name: "查看" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "调整范围" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "移除" })).toBeDisabled()
  })

  it("提供预算、风险、查看、调整、移除和十秒撤销操作", () => {
    const onPreview = vi.fn()
    const onAdjust = vi.fn()
    const onRemove = vi.fn()
    const onUndo = vi.fn()
    const { rerender } = renderWithRelayIntl(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: "relay_budget_exceeded",
          status: "draft",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={onPreview}
        onAdjust={onAdjust}
        onRemove={onRemove}
        onUndo={onUndo}
        onRefresh={vi.fn()}
      />
    )
    expect(screen.getByText("产品需求讨论")).toBeInTheDocument()
    expect(
      screen.getByText("32 条消息 · 4 个文件 · 3 项待办")
    ).toBeInTheDocument()
    expect(screen.getByText("范围：最近 10 轮")).toBeInTheDocument()
    expect(screen.getByText("Token 预算：1,200 / 4,000")).toBeInTheDocument()
    expect(screen.getByText("上下文预算超限")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "查看" }))
    fireEvent.click(screen.getByRole("button", { name: "调整范围" }))
    fireEvent.click(screen.getByRole("button", { name: "移除" }))
    expect(onPreview).toHaveBeenCalledOnce()
    expect(onAdjust).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()

    rerender(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: null,
          status: "removed",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={onPreview}
        onAdjust={onAdjust}
        onRemove={onRemove}
        onUndo={onUndo}
        onRefresh={vi.fn()}
      />
    )
    expect(screen.getByText("10 秒内可撤销")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "撤销移除" }))
    expect(onUndo).toHaveBeenCalledOnce()
  })

  it.each([
    ["recent_rounds", [], "范围：最近 10 轮"],
    ["custom_rounds", ["round-1", "round-2"], "范围：自定义 2 轮"],
    ["summary", [], "范围：摘要"],
  ] as const)("显示 %s 接力范围", (scopeType, selectedRoundIds, label) => {
    renderWithRelayIntl(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType, selectedRoundIds: [...selectedRoundIds] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: null,
          status: "attached",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={vi.fn()}
        onAdjust={vi.fn()}
        onRemove={vi.fn()}
        onUndo={vi.fn()}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it("marks an updated source and refreshes the frozen context", () => {
    const onRefresh = vi.fn()
    renderWithRelayIntl(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: "relay_rounds_changed",
          status: "draft",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={vi.fn()}
        onAdjust={vi.fn()}
        onRemove={vi.fn()}
        onUndo={vi.fn()}
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText("来源已更新")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "刷新接力内容" }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it.each([
    ["relay_model_changed", "目标模型已变化"],
    ["relay_send_uncertain", "发送结果不确定，请先检查当前会话"],
  ])("shows %s with an explicit recovery action", (invalidReason, message) => {
    const onRefresh = vi.fn()
    renderWithRelayIntl(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
          scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason,
          status: "invalid",
          snapshot: {
            stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
          },
        }}
        onPreview={vi.fn()}
        onAdjust={vi.fn()}
        onRemove={vi.fn()}
        onUndo={vi.fn()}
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByText(message)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "重新准备接力" }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it.each(["relay_source_not_found", "relay_source_unavailable"])(
    "shows %s as unavailable with an explicit recovery action",
    (invalidReason) => {
      const onRefresh = vi.fn()
      renderWithRelayIntl(
        <RelayContextCard
          sourceTitle="产品需求讨论"
          relay={{
            sourceConversationId: 42,
            scope: { scopeType: "recent_rounds", selectedRoundIds: [] },
            estimatedTokens: 1200,
            allowedTokens: 4000,
            invalidReason,
            status: "invalid",
            snapshot: {
              stats: { messageCount: 32, fileCount: 4, todoCount: 3 },
            },
          }}
          onPreview={vi.fn()}
          onAdjust={vi.fn()}
          onRemove={vi.fn()}
          onUndo={vi.fn()}
          onRefresh={onRefresh}
        />
      )

      expect(screen.getByText("接力上下文准备失败，请重试")).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "重新准备接力" }))
      expect(onRefresh).toHaveBeenCalledOnce()
    }
  )
})

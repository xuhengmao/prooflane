import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RelayContextCard } from "./relay-context-card"

describe("RelayContextCard", () => {
  it("提供预算、风险、查看、调整、移除和十秒撤销操作", () => {
    const onPreview = vi.fn()
    const onAdjust = vi.fn()
    const onRemove = vi.fn()
    const onUndo = vi.fn()
    const { rerender } = render(
      <RelayContextCard
        sourceTitle="产品需求讨论"
        relay={{
          sourceConversationId: 42,
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
      />
    )
    expect(screen.getByText("产品需求讨论")).toBeInTheDocument()
    expect(
      screen.getByText("32 条消息 · 4 个文件 · 3 项待办")
    ).toBeInTheDocument()
    expect(screen.getByText("1,200 / 4,000")).toBeInTheDocument()
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
      />
    )
    expect(screen.getByText("10 秒内可撤销")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "撤销移除" }))
    expect(onUndo).toHaveBeenCalledOnce()
  })
})

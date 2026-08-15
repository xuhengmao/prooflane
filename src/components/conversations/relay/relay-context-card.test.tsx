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
        relay={{
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: "relay_budget_exceeded",
          status: "draft",
        }}
        onPreview={onPreview}
        onAdjust={onAdjust}
        onRemove={onRemove}
        onUndo={onUndo}
      />
    )
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
        relay={{
          estimatedTokens: 1200,
          allowedTokens: 4000,
          invalidReason: null,
          status: "removed",
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

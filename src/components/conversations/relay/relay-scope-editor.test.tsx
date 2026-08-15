import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RelayScopeEditor } from "./relay-scope-editor"

const rounds = Array.from({ length: 12 }, (_, index) => ({
  id: `round-${index + 1}`,
  userText: `问题 ${index + 1}`,
  assistantText: `回答 ${index + 1}`,
  tools: [],
  files: [],
  sourceMessageIds: [],
}))

describe("RelayScopeEditor", () => {
  it("默认选择最近 10 个完整轮次，并支持非连续自定义选择", () => {
    const onChange = vi.fn()
    render(<RelayScopeEditor rounds={rounds} onChange={onChange} />)

    expect(screen.getByLabelText("round-3")).toBeChecked()
    expect(screen.queryByLabelText("round-1")).not.toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "自定义轮次" }))
    fireEvent.click(screen.getByLabelText("round-1"))
    fireEvent.click(screen.getByLabelText("round-4"))
    expect(onChange).toHaveBeenLastCalledWith({
      scopeType: "custom_rounds",
      selectedRoundIds: ["round-1", "round-4"],
    })
  })

  it("展示摘要加载与失败状态", () => {
    const { rerender } = render(
      <RelayScopeEditor
        rounds={rounds}
        summaryState="loading"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("正在生成摘要")).toBeInTheDocument()
    rerender(
      <RelayScopeEditor
        rounds={rounds}
        summaryState="error"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("摘要暂不可用")).toBeInTheDocument()
  })
})

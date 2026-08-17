import { fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { RelayScopeEditor } from "./relay-scope-editor"
import { renderWithRelayIntl } from "./relay-test-utils"

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
    renderWithRelayIntl(
      <RelayScopeEditor rounds={rounds} onChange={onChange} />
    )

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
    const { rerender } = renderWithRelayIntl(
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

  it("在打开时采用外部重载后的范围，避免提交 CAS 冲突前的选择", () => {
    const onChange = vi.fn()
    const { rerender } = renderWithRelayIntl(
      <RelayScopeEditor
        rounds={rounds}
        value={{
          scopeType: "custom_rounds",
          selectedRoundIds: ["round-1"],
        }}
        onChange={onChange}
      />
    )

    rerender(
      <RelayScopeEditor
        rounds={rounds}
        value={{
          scopeType: "custom_rounds",
          selectedRoundIds: ["round-3"],
        }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByLabelText("round-2"))
    expect(onChange).toHaveBeenLastCalledWith({
      scopeType: "custom_rounds",
      selectedRoundIds: ["round-3", "round-2"],
    })
  })
})

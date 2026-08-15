import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { RelayConversationPicker } from "./relay-conversation-picker"

const conversations = [
  { id: 1, folder_id: 10, title: "当前项目会话", agent_type: "codex" },
  { id: 2, folder_id: 20, title: "跨项目会话", agent_type: "claude_code" },
]

describe("RelayConversationPicker", () => {
  function renderPicker(onSelect = vi.fn()) {
    render(
      <RelayConversationPicker
        conversations={conversations}
        folders={[
          { id: 10, name: "当前项目" },
          { id: 20, name: "其他项目" },
        ]}
        currentFolderId={10}
        selectedConversationId={null}
        onSelect={onSelect}
      />
    )
    return onSelect
  }

  it("默认当前项目、可切换全部项目并单选", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    renderPicker(onSelect)

    expect(screen.getByText("当前项目会话")).toBeInTheDocument()
    expect(screen.queryByText("跨项目会话")).toBeNull()
    await user.click(screen.getByRole("button", { name: "全部项目" }))
    await user.click(screen.getByText("跨项目会话"))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it("按会话标题搜索", async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole("button", { name: "全部项目" }))
    await user.type(screen.getByRole("searchbox"), "跨项目会话")

    expect(screen.getByText("跨项目会话")).toBeInTheDocument()
    expect(screen.queryByText("当前项目会话")).not.toBeInTheDocument()
  })

  it("按项目名称搜索", async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole("button", { name: "全部项目" }))
    await user.type(screen.getByRole("searchbox"), "其他项目")

    expect(screen.getByText("跨项目会话")).toBeInTheDocument()
    expect(screen.queryByText("当前项目会话")).not.toBeInTheDocument()
  })

  it("按智能体类型搜索", async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole("button", { name: "全部项目" }))
    await user.type(screen.getByRole("searchbox"), "claude")

    expect(screen.getByText("跨项目会话")).toBeInTheDocument()
    expect(screen.queryByText("当前项目会话")).not.toBeInTheDocument()
  })

  it("无项目聊天草稿明确落到全部项目", () => {
    render(
      <RelayConversationPicker
        conversations={conversations}
        folders={[]}
        currentFolderId={null}
        selectedConversationId={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText("当前会话未关联项目")).toBeInTheDocument()
    expect(screen.getByText("跨项目会话")).toBeInTheDocument()
  })
})

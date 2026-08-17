import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { RelayEntryStatus } from "./relay-entry-status"
import { renderWithRelayIntl } from "./relay-test-utils"

describe("RelayEntryStatus", () => {
  it("shows a non-blocking loading state while history is attached", () => {
    renderWithRelayIntl(
      <RelayEntryStatus state="loading" onRetry={vi.fn()} onClear={vi.fn()} />
    )

    expect(screen.getByRole("status")).toHaveTextContent("正在接入历史会话")
    expect(
      screen.queryByRole("button", { name: "重试" })
    ).not.toBeInTheDocument()
  })

  it("keeps a failed entry visible and retries on demand", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onClear = vi.fn()
    renderWithRelayIntl(
      <RelayEntryStatus state="error" onRetry={onRetry} onClear={onClear} />
    )

    expect(screen.getByRole("alert")).toHaveTextContent("接力上下文准备失败")
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
    await user.click(screen.getByRole("button", { name: "移除" }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})

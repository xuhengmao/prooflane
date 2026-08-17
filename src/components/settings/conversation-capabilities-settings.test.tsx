import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-conversation-capabilities", () => ({
  useConversationCapabilities: vi.fn(),
}))

import { useConversationCapabilities } from "@/hooks/use-conversation-capabilities"
import { ConversationCapabilitiesSettings } from "./conversation-capabilities-settings"

describe("ConversationCapabilitiesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the enabled-by-default relay switch and persists a change", async () => {
    const setRelayEnabled = vi.fn(async () => {})
    vi.mocked(useConversationCapabilities).mockReturnValue({
      settings: { relayEnabled: true },
      loading: false,
      setRelayEnabled,
    })

    render(<ConversationCapabilitiesSettings />)

    expect(
      screen.getByRole("heading", { level: 1, name: "会话能力" })
    ).toBeInTheDocument()
    const relaySwitch = screen.getByLabelText("会话接力")
    expect(relaySwitch).toHaveAttribute("data-state", "checked")
    fireEvent.click(relaySwitch)
    await waitFor(() => expect(setRelayEnabled).toHaveBeenCalledWith(false))
    expect(screen.queryByText("长期记忆")).not.toBeInTheDocument()
  })

  it("handles a failed save and keeps the confirmed switch state", async () => {
    const setRelayEnabled = vi.fn().mockRejectedValue(new Error("boom"))
    vi.mocked(useConversationCapabilities).mockReturnValue({
      settings: { relayEnabled: true },
      loading: false,
      setRelayEnabled,
    })

    render(<ConversationCapabilitiesSettings />)
    const relaySwitch = screen.getByLabelText("会话接力")
    fireEvent.click(relaySwitch)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存会话接力设置失败：boom"
    )
    expect(relaySwitch).toHaveAttribute("data-state", "checked")
  })
})

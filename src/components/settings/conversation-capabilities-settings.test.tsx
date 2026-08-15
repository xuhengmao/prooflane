import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-conversation-capabilities", () => ({
  useConversationCapabilities: vi.fn(),
}))

import { useConversationCapabilities } from "@/hooks/use-conversation-capabilities"
import { ConversationCapabilitiesSettings } from "./conversation-capabilities-settings"

describe("ConversationCapabilitiesSettings", () => {
  it("shows the enabled-by-default relay switch and persists a change", async () => {
    const setRelayEnabled = vi.fn(async () => {})
    vi.mocked(useConversationCapabilities).mockReturnValue({
      settings: { relayEnabled: true },
      loading: false,
      setRelayEnabled,
    })

    render(<ConversationCapabilitiesSettings />)

    const relaySwitch = screen.getByLabelText("启用会话接力")
    expect(relaySwitch).toHaveAttribute("data-state", "checked")
    fireEvent.click(relaySwitch)
    await waitFor(() => expect(setRelayEnabled).toHaveBeenCalledWith(false))
    expect(screen.queryByText("长期记忆")).not.toBeInTheDocument()
  })
})

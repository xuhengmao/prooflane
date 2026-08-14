import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationNotificationSettingsSection } from "./conversation-notification-settings"
import {
  CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY,
  getConversationNotificationPrefs,
  resetConversationNotificationPrefsCacheForTests,
} from "@/lib/conversation-notification-prefs"

const h = vi.hoisted(() => ({
  getState: vi.fn(),
  requestPermission: vi.fn(),
  openSettings: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("@/lib/conversation-notification-runtime", () => ({
  conversationNotificationRuntime: {
    getState: h.getState,
    requestPermission: h.requestPermission,
    openSettings: h.openSettings,
  },
}))

vi.mock("sonner", () => ({
  toast: { error: h.toastError, info: h.toastInfo },
}))

describe("ConversationNotificationSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(CONVERSATION_NOTIFICATION_PREFS_STORAGE_KEY)
    resetConversationNotificationPrefsCacheForTests()
    h.getState.mockResolvedValue({ appFocused: false, permission: "prompt" })
    h.requestPermission.mockResolvedValue({ permission: "granted" })
    h.openSettings.mockResolvedValue(true)
  })

  it("defaults on and waits for an explicit click before requesting permission", async () => {
    render(<ConversationNotificationSettingsSection />)

    const toggle = screen.getByRole("switch", { name: "title" })
    expect(toggle).toHaveAttribute("data-state", "checked")
    expect(await screen.findByText("permission.prompt")).toBeInTheDocument()
    expect(h.requestPermission).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "allow" }))

    await waitFor(() =>
      expect(screen.getByText("permission.granted")).toBeInTheDocument()
    )
    expect(h.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("persists the disabled preference and hides permission actions", async () => {
    render(<ConversationNotificationSettingsSection />)
    await screen.findByText("permission.prompt")

    fireEvent.click(screen.getByRole("switch", { name: "title" }))

    expect(getConversationNotificationPrefs()).toEqual({ enabled: false })
    expect(
      screen.queryByRole("button", { name: "allow" })
    ).not.toBeInTheDocument()
  })

  it("offers the operating-system settings entry when permission is denied", async () => {
    h.getState.mockResolvedValue({ appFocused: false, permission: "denied" })
    render(<ConversationNotificationSettingsSection />)

    expect(await screen.findByText("permission.denied")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "openSettings" }))

    await waitFor(() => expect(h.openSettings).toHaveBeenCalledTimes(1))
    expect(h.requestPermission).not.toHaveBeenCalled()
  })

  it("shows unsupported without offering a permission retry loop", async () => {
    h.getState.mockResolvedValue({
      appFocused: false,
      permission: "unsupported",
    })
    render(<ConversationNotificationSettingsSection />)

    expect(
      await screen.findByText("permission.unsupported")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "allow" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "openSettings" })
    ).not.toBeInTheDocument()
  })
})

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Circle } from "lucide-react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { ComposerShortcuts } from "./use-composer-shortcuts"
import { ComposerAddMenu } from "./composer-add-menu"

function shortcuts(): ComposerShortcuts {
  return {
    quickMessages: [],
    quickMessagesLoading: false,
    refreshQuickMessages: vi.fn(),
    insertQuickMessage: vi.fn(),
    insertSlashCommand: vi.fn(),
    experts: [],
    science: [],
    officeActions: [],
    skillManagementSupported: false,
    isSkillLocked: () => false,
    expertLabel: () => "",
    scienceLabel: () => "",
    officeLabel: () => "",
    getExpertIcon: () => Circle,
    getScienceIcon: () => Circle,
    insertExpert: vi.fn(),
    insertScience: vi.fn(),
    insertOffice: vi.fn(),
  }
}

function renderMenu(onAddRelay?: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComposerAddMenu
        shortcuts={shortcuts()}
        slashCommands={[]}
        onAddRelay={onAddRelay}
      />
    </NextIntlClientProvider>
  )
}

describe("ComposerAddMenu relay entry", () => {
  it("hides the historical relay action when no relay entry is available", async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.addActions,
      })
    )

    expect(screen.queryByText("接入历史会话")).not.toBeInTheDocument()
  })

  it("opens historical relay selection from the add menu", async () => {
    const user = userEvent.setup()
    const onAddRelay = vi.fn()
    renderMenu(onAddRelay)

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.addActions,
      })
    )
    await user.click(screen.getByText("接入历史会话"))

    expect(onAddRelay).toHaveBeenCalledOnce()
  })
})

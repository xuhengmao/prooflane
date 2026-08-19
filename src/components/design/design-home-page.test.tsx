import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DesignArtifact } from "@/lib/design/artifact"
import type { DesignArtifactService } from "@/lib/design/artifact-service"
import { DesignWorkspaceProvider } from "@/contexts/design-workspace-context"
import { DesignHomePage } from "./design-home-page"

function artifact(overrides: Partial<DesignArtifact> = {}): DesignArtifact {
  return {
    id: "artifact-1",
    name: "Account dashboard",
    kind: "page",
    status: "draft",
    currentRevisionId: "revision-1",
    projectFolderId: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T01:00:00.000Z",
    deletedAt: null,
    ...overrides,
  }
}

function service(
  items: DesignArtifact[] = [artifact()]
): DesignArtifactService {
  return {
    list: vi.fn().mockResolvedValue(items),
    get: vi.fn(),
    create: vi.fn().mockImplementation(async (input) =>
      artifact({
        id: "created-artifact",
        name: input.name,
        kind: input.kind,
      })
    ),
    rename: vi
      .fn()
      .mockImplementation(async (id, name) => artifact({ id, name })),
    duplicate: vi
      .fn()
      .mockResolvedValue(
        artifact({ id: "copy", name: "Account dashboard copy" })
      ),
    setArchived: vi.fn().mockImplementation(async (id, archived) =>
      artifact({
        id,
        name: "Revenue dashboard",
        status: archived ? "archived" : "active",
      })
    ),
    delete: vi.fn().mockResolvedValue(undefined),
    saveRevision: vi.fn(),
  }
}

function renderPage(designService: DesignArtifactService) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DesignWorkspaceProvider>
        <DesignHomePage service={designService} />
      </DesignWorkspaceProvider>
    </NextIntlClientProvider>
  )
}

describe("DesignHomePage", () => {
  it("loads persisted artifacts and opens one in the workspace", async () => {
    const designService = service()
    const user = userEvent.setup()
    renderPage(designService)

    expect(await screen.findByText("Account dashboard")).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Open Account dashboard" })
    )

    expect(screen.getByTestId("active-design-artifact").textContent).toBe(
      "artifact-1"
    )
  })

  it("creates an independent design without requesting a project", async () => {
    const designService = service([])
    const user = userEvent.setup()
    renderPage(designService)

    await user.click(await screen.findByRole("button", { name: "New design" }))
    await user.type(screen.getByLabelText("Name"), "Checkout flow")
    await user.click(screen.getByRole("button", { name: "Create design" }))

    expect(designService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Checkout flow",
        kind: "page",
        projectFolderId: null,
      })
    )
    expect(screen.getByTestId("active-design-artifact").textContent).toBe(
      "created-artifact"
    )
  })

  it("filters by search text and retries a failed load", async () => {
    const designService = service([
      artifact(),
      artifact({ id: "settings", name: "Settings" }),
    ])
    vi.mocked(designService.list)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([
        artifact(),
        artifact({ id: "settings", name: "Settings" }),
      ])
    const user = userEvent.setup()
    renderPage(designService)

    expect(await screen.findByText("Could not load designs")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Account dashboard")).toBeTruthy()

    await user.type(
      screen.getByRole("searchbox", { name: "Search designs" }),
      "settings"
    )
    expect(screen.queryByText("Account dashboard")).toBeNull()
    expect(screen.getByText("Settings")).toBeTruthy()
  })

  it("renames, duplicates, archives, and deletes through row actions", async () => {
    const designService = service()
    const user = userEvent.setup()
    renderPage(designService)
    await screen.findByText("Account dashboard")

    await user.click(
      screen.getByRole("button", { name: "More actions for Account dashboard" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Rename" }))
    const nameInput = screen.getByLabelText("Name")
    await user.clear(nameInput)
    await user.type(nameInput, "Revenue dashboard")
    await user.click(screen.getByRole("button", { name: "Save name" }))
    expect(designService.rename).toHaveBeenCalledWith(
      "artifact-1",
      "Revenue dashboard"
    )

    await user.click(
      screen.getByRole("button", { name: "More actions for Revenue dashboard" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    await waitFor(() => expect(designService.duplicate).toHaveBeenCalled())

    await user.click(
      screen.getByRole("button", { name: "More actions for Revenue dashboard" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Archive" }))
    await waitFor(() =>
      expect(designService.setArchived).toHaveBeenCalledWith("artifact-1", true)
    )

    await user.click(
      screen.getByRole("button", { name: "More actions for Revenue dashboard" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete" }))
    await user.click(screen.getByRole("button", { name: "Delete design" }))
    await waitFor(() =>
      expect(designService.delete).toHaveBeenCalledWith("artifact-1")
    )
  }, 15_000)
})

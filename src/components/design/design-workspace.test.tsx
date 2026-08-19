import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DesignDocument } from "@/lib/design/ast"
import type {
  DesignArtifactDetail,
  DesignArtifactService,
} from "@/lib/design/artifact-service"
import { DesignWorkspaceProvider } from "@/contexts/design-workspace-context"
import { WORKSPACE_SESSION_STORAGE_KEY } from "@/lib/design/workspace-session"
import { DesignWorkspace } from "./design-workspace"

const detail: DesignArtifactDetail = {
  artifact: {
    id: "artifact-1",
    name: "Checkout flow",
    kind: "page",
    status: "draft",
    currentRevisionId: "revision-1",
    projectFolderId: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T01:00:00.000Z",
    deletedAt: null,
  },
  revision: {
    id: "revision-1",
    artifactId: "artifact-1",
    parentRevisionId: null,
    revisionNumber: 1,
    schemaVersion: 1,
    document: { schemaVersion: 1, brief: "A checkout page" },
    createdAt: "2026-08-19T01:00:00.000Z",
  },
}

const existingDocument: DesignDocument = {
  version: 1,
  revision: "document-revision-1",
  rootId: "existing-frame",
  nodes: [
    {
      id: "existing-frame",
      type: "frame",
      bounds: { x: 0, y: 0, width: 1024, height: 768 },
    },
    {
      id: "existing-title",
      type: "text",
      parentId: "existing-frame",
      bounds: { x: 48, y: 48, width: 400, height: 64 },
      text: "Existing design",
    },
  ],
}

function service(overrides: Partial<DesignArtifactService> = {}) {
  return {
    list: vi.fn(),
    get: vi.fn().mockResolvedValue(detail),
    create: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    setArchived: vi.fn(),
    delete: vi.fn(),
    saveRevision: vi.fn().mockResolvedValue({
      ...detail,
      artifact: { ...detail.artifact, currentRevisionId: "revision-2" },
      revision: { ...detail.revision, id: "revision-2", revisionNumber: 2 },
    }),
    ...overrides,
  } satisfies DesignArtifactService
}

function renderWorkspace(designService: DesignArtifactService) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DesignWorkspaceProvider>
        <DesignWorkspace artifactId="artifact-1" service={designService} />
      </DesignWorkspaceProvider>
    </NextIntlClientProvider>
  )
}

describe("DesignWorkspace", () => {
  it("renders the starter SVG for a placeholder without saving automatically", async () => {
    const designService = service()
    renderWorkspace(designService)

    expect(await screen.findByText("Hello，Prooflane")).toBeTruthy()
    expect(
      screen.getByTestId("design-svg-canvas").getAttribute("viewBox")
    ).toBe("0 0 1440 900")
    expect(designService.saveRevision).not.toHaveBeenCalled()
  })

  it("restores an existing DesignDocument instead of replacing it", async () => {
    renderWorkspace(
      service({
        get: vi.fn().mockResolvedValue({
          ...detail,
          revision: { ...detail.revision, document: existingDocument },
        }),
      })
    )

    expect(await screen.findByText("Existing design")).toBeTruthy()
    expect(screen.queryByText("Hello，Prooflane")).toBeNull()
    expect(
      screen.getByTestId("design-svg-canvas").getAttribute("viewBox")
    ).toBe("0 0 1024 768")
  })

  it("edits a selected node through the properties panel without auto-saving", async () => {
    const user = userEvent.setup()
    const designService = service()
    renderWorkspace(designService)

    await user.click(await screen.findByTestId("design-node-title-text"))
    const text = screen.getByLabelText("Text content")
    expect(text).toHaveValue("Hello，Prooflane")

    await user.clear(text)
    await user.type(text, "Updated from properties")
    fireEvent.blur(text)

    await waitFor(() =>
      expect(screen.getByTestId("design-node-title-text")).toHaveTextContent(
        "Updated from properties"
      )
    )
    expect(designService.saveRevision).not.toHaveBeenCalled()
  })

  it("rejects a damaged design document instead of replacing it", async () => {
    renderWorkspace(
      service({
        get: vi.fn().mockResolvedValue({
          ...detail,
          revision: {
            ...detail.revision,
            document: {
              version: 1,
              revision: "broken",
              nodes: [{ id: "node", type: "unknown" }],
            },
          },
        }),
      })
    )

    expect(await screen.findByText("Could not load this design")).toBeTruthy()
    expect(screen.queryByTestId("design-svg-canvas")).toBeNull()
  })

  it("loads a real artifact detail and keeps the artifact across view changes", async () => {
    const designService = service()
    const user = userEvent.setup()
    renderWorkspace(designService)

    expect(await screen.findByDisplayValue("Checkout flow")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Prototype" }))

    expect(screen.getByTestId("design-active-view").textContent).toBe(
      "prototype"
    )
    expect(screen.getByTestId("design-active-artifact").textContent).toBe(
      "artifact-1"
    )
  })

  it("saves the current revision from Ctrl/Cmd+S", async () => {
    const designService = service()
    renderWorkspace(designService)
    await screen.findByDisplayValue("Checkout flow")

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true })
      )
    })

    await waitFor(() =>
      expect(designService.saveRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: "artifact-1",
          expectedRevisionId: "revision-1",
          schemaVersion: 1,
          document: expect.objectContaining({
            version: 1,
            rootId: "root-frame",
          }),
        })
      )
    )
    expect(await screen.findByText("Saved")).toBeTruthy()
  })

  it("saves the edited local document instead of the loaded placeholder", async () => {
    const user = userEvent.setup()
    const designService = service()
    renderWorkspace(designService)

    await screen.findByDisplayValue("Checkout flow")
    await user.click(screen.getByRole("button", { name: "Design" }))
    await user.click(await screen.findByTestId("design-node-title-text"))
    const text = screen.getByLabelText("Text content")
    await user.clear(text)
    await user.type(text, "Saved design")
    fireEvent.blur(text)
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(designService.saveRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({
                id: "title-text",
                text: "Saved design",
              }),
            ]),
          }),
        })
      )
    )
  })

  it("keeps edited nodes and the unsaved state when saving fails", async () => {
    const user = userEvent.setup()
    const designService = service({
      saveRevision: vi.fn().mockRejectedValue(new Error("network unavailable")),
    })
    renderWorkspace(designService)

    await screen.findByDisplayValue("Checkout flow")
    await user.click(screen.getByRole("button", { name: "Design" }))
    await user.click(await screen.findByTestId("design-node-title-text"))
    const text = screen.getByLabelText("Text content")
    await user.clear(text)
    await user.type(text, "Retry me")
    fireEvent.blur(text)
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Could not save")).toBeTruthy()
    expect(screen.getByTestId("design-node-title-text")).toHaveTextContent(
      "Retry me"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(designService.saveRevision).toHaveBeenCalledTimes(2)
    expect(designService.saveRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "title-text", text: "Retry me" }),
          ]),
        }),
      })
    )
  })

  it("shows an update conflict without replacing the local revision", async () => {
    const user = userEvent.setup()
    const designService = service({
      saveRevision: vi
        .fn()
        .mockRejectedValue(new Error("revision conflict: already updated")),
    })
    renderWorkspace(designService)
    await screen.findByDisplayValue("Checkout flow")
    await user.click(screen.getByRole("button", { name: "Design" }))
    await user.click(await screen.findByTestId("design-node-title-text"))
    const text = screen.getByLabelText("Text content")
    await user.clear(text)
    await user.type(text, "Local conflict edit")
    fireEvent.blur(text)

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true })
      )
    })

    expect(await screen.findByText("An update is available")).toBeTruthy()
    expect(screen.getByTestId("design-node-title-text")).toHaveTextContent(
      "Local conflict edit"
    )
    expect(screen.getByTestId("design-current-revision").textContent).toBe(
      "revision-1"
    )
  })

  it("shows a recovery action when the artifact cannot be loaded", async () => {
    localStorage.setItem(
      WORKSPACE_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, artifactId: "missing" })
    )
    const designService = service({
      get: vi.fn().mockRejectedValue(new Error("artifact not found")),
    })
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DesignWorkspaceProvider>
          <DesignWorkspace
            artifactId="missing"
            service={designService}
            onBack={onBack}
          />
        </DesignWorkspaceProvider>
      </NextIntlClientProvider>
    )

    expect(await screen.findByText("Could not load this design")).toBeTruthy()
    expect(localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY)).toBeNull()
    await user.click(screen.getByRole("button", { name: "Back to designs" }))
    expect(onBack).toHaveBeenCalled()
  })

  it("offers zoom and panel visibility controls without resizing the canvas host", async () => {
    const user = userEvent.setup()
    renderWorkspace(service())
    await screen.findByDisplayValue("Checkout flow")

    await user.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(screen.getByText("110%")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Hide layers panel" }))
    expect(screen.queryByText("Design structure")).toBeNull()
    expect(screen.getByTestId("design-canvas-host")).toBeTruthy()
  })
})

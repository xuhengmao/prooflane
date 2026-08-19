import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { DesignDocument } from "@/lib/design/ast"
import { DesignSvgCanvas } from "./design-svg-canvas"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  rootId: "frame",
  nodes: [
    {
      id: "frame",
      type: "frame",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      style: { fill: "#ffffff" },
    },
    {
      id: "rectangle",
      type: "rectangle",
      parentId: "frame",
      bounds: { x: 24, y: 24, width: 200, height: 120 },
      style: { fill: "#38bf63", borderRadius: 8 },
    },
    {
      id: "title",
      type: "text",
      parentId: "frame",
      bounds: { x: 48, y: 180, width: 360, height: 48 },
      text: "<Prooflane & Design>",
      style: { fill: "#111827", fontSize: 32, fontWeight: 600 },
    },
    {
      id: "image",
      type: "image",
      parentId: "frame",
      bounds: { x: 460, y: 24, width: 240, height: 180 },
      assetRef: "missing://hero.png",
    },
    {
      id: "locked",
      type: "rectangle",
      parentId: "frame",
      bounds: { x: 24, y: 260, width: 100, height: 80 },
      locked: true,
    },
    {
      id: "hidden",
      type: "rectangle",
      parentId: "frame",
      bounds: { x: 140, y: 260, width: 100, height: 80 },
      visible: false,
    },
  ],
}

function renderCanvas(
  overrides: Partial<React.ComponentProps<typeof DesignSvgCanvas>> = {}
) {
  const onSelectNode = vi.fn()
  const onMoveNode = vi.fn()
  render(
    <DesignSvgCanvas
      document={document}
      zoom={1}
      ariaLabel="Design canvas"
      selectedNodeId={null}
      onSelectNode={onSelectNode}
      onMoveNode={onMoveNode}
      {...overrides}
    />
  )
  return { onSelectNode, onMoveNode }
}

describe("DesignSvgCanvas", () => {
  it("renders supported nodes and a missing-image placeholder safely", () => {
    renderCanvas()

    expect(
      screen.getByTestId("design-svg-canvas").getAttribute("viewBox")
    ).toBe("0 0 800 600")
    expect(screen.getByTestId("design-node-frame").tagName.toLowerCase()).toBe(
      "rect"
    )
    expect(screen.getByTestId("design-node-rectangle")).toBeTruthy()
    expect(screen.getByText("<Prooflane & Design>")).toBeTruthy()
    expect(screen.getByTestId("design-image-placeholder-image")).toBeTruthy()
    expect(screen.queryByTestId("design-node-hidden")).toBeNull()
  })

  it("selects editable nodes, ignores locked nodes, and clears from the canvas", async () => {
    const user = userEvent.setup()
    const { onSelectNode } = renderCanvas()

    await user.click(screen.getByTestId("design-node-title"))
    expect(onSelectNode).toHaveBeenLastCalledWith("title")

    await user.click(screen.getByTestId("design-node-locked"))
    expect(onSelectNode).not.toHaveBeenCalledWith("locked")

    fireEvent.click(screen.getByTestId("design-svg-canvas"))
    expect(onSelectNode).toHaveBeenLastCalledWith(null)
  })

  it("offers keyboard selection and reports the selected node", async () => {
    const user = userEvent.setup()
    const onSelectNode = vi.fn()
    renderCanvas({ selectedNodeId: "rectangle", onSelectNode })

    const rectangle = screen.getByTestId("design-node-rectangle")
    expect(rectangle.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByTestId("design-selection-outline")).toBeTruthy()

    rectangle.focus()
    await user.keyboard("{Enter}")
    expect(onSelectNode).toHaveBeenCalledWith("rectangle")
  })
})

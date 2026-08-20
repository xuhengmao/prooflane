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
      viewport={
        overrides.viewport ?? {
          centerX: 400,
          centerY: 300,
          width: 800,
          height: 600,
          zoom: 1,
        }
      }
      ariaLabel="Design canvas"
      selectedNodeId={null}
      onSelectNode={onSelectNode}
      onMoveNode={onMoveNode}
      {...overrides}
    />
  )
  return { onSelectNode, onMoveNode }
}

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  props: { pointerId: number; clientX: number; clientY: number }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, ...props })
  fireEvent(target, event)
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

    await user.keyboard("{Escape}")
    expect(onSelectNode).toHaveBeenLastCalledWith(null)
  })

  it.each([
    {
      label: "100%",
      viewport: {
        centerX: 400,
        centerY: 300,
        width: 800,
        height: 600,
        zoom: 1,
      },
      scale: 1,
    },
    {
      label: "200%",
      viewport: {
        centerX: 200,
        centerY: 150,
        width: 400,
        height: 300,
        zoom: 2,
      },
      scale: 0.5,
    },
  ])(
    "previews a drag and commits one document-coordinate move at $label zoom",
    ({ viewport, scale }) => {
      const { onMoveNode } = renderCanvas({ viewport })
      const canvas = screen.getByTestId("design-svg-canvas")
      const viewWidth = viewport.width
      const viewHeight = viewport.height
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: viewWidth * scale,
        bottom: viewHeight * scale,
        width: viewWidth * scale,
        height: viewHeight * scale,
        toJSON: () => ({}),
      })
      const rectangle = screen.getByTestId("design-node-rectangle")

      firePointer(rectangle, "pointerdown", {
        pointerId: 1,
        clientX: 24 * scale,
        clientY: 24 * scale,
      })
      firePointer(rectangle, "pointermove", {
        pointerId: 1,
        clientX: 64 * scale,
        clientY: 54 * scale,
      })

      expect(rectangle.getAttribute("x")).toBe("64")
      expect(rectangle.getAttribute("y")).toBe("54")
      expect(onMoveNode).not.toHaveBeenCalled()

      firePointer(rectangle, "pointerup", {
        pointerId: 1,
        clientX: 64 * scale,
        clientY: 54 * scale,
      })
      expect(onMoveNode).toHaveBeenCalledTimes(1)
      expect(onMoveNode).toHaveBeenCalledWith("rectangle", 64, 54)
    }
  )

  it("does not move a locked node", () => {
    const { onMoveNode } = renderCanvas()
    const locked = screen.getByTestId("design-node-locked")

    firePointer(locked, "pointerdown", {
      pointerId: 1,
      clientX: 24,
      clientY: 260,
    })
    firePointer(locked, "pointermove", {
      pointerId: 1,
      clientX: 48,
      clientY: 280,
    })
    firePointer(locked, "pointerup", {
      pointerId: 1,
      clientX: 48,
      clientY: 280,
    })

    expect(onMoveNode).not.toHaveBeenCalled()
  })

  it("renders a translated and zoomed viewBox without CSS scaling", () => {
    renderCanvas({
      viewport: {
        centerX: 500,
        centerY: 350,
        width: 400,
        height: 300,
        zoom: 2,
      },
    })
    const canvas = screen.getByTestId("design-svg-canvas")
    expect(canvas.getAttribute("viewBox")).toBe("300 200 400 300")
    expect(canvas.getAttribute("style")).toBeNull()
  })

  it("adds and removes nodes with modifier-click selection", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    const view = render(
      <DesignSvgCanvas
        document={document}
        viewport={{
          centerX: 400,
          centerY: 300,
          width: 800,
          height: 600,
          zoom: 1,
        }}
        ariaLabel="Design canvas"
        selectedNodeIds={[]}
        onSelectionChange={onSelectionChange}
        onMoveNode={vi.fn()}
      />
    )

    await user.click(screen.getByTestId("design-node-rectangle"))
    expect(onSelectionChange).toHaveBeenLastCalledWith(["rectangle"])
    view.rerender(
      <DesignSvgCanvas
        document={document}
        viewport={{
          centerX: 400,
          centerY: 300,
          width: 800,
          height: 600,
          zoom: 1,
        }}
        ariaLabel="Design canvas"
        selectedNodeIds={["rectangle"]}
        onSelectionChange={onSelectionChange}
        onMoveNode={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId("design-node-title"), { shiftKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(["rectangle", "title"])
    view.rerender(
      <DesignSvgCanvas
        document={document}
        viewport={{
          centerX: 400,
          centerY: 300,
          width: 800,
          height: 600,
          zoom: 1,
        }}
        ariaLabel="Design canvas"
        selectedNodeIds={["rectangle", "title"]}
        onSelectionChange={onSelectionChange}
        onMoveNode={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId("design-node-rectangle"), {
      shiftKey: true,
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(["title"])
  })

  it("selects nodes intersecting a document-coordinate marquee", () => {
    const onSelectionChange = vi.fn()
    renderCanvas({ selectedNodeIds: [], onSelectionChange })
    const canvas = screen.getByTestId("design-svg-canvas")
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })

    firePointer(canvas, "pointerdown", {
      pointerId: 9,
      clientX: 20,
      clientY: 20,
    })
    firePointer(canvas, "pointermove", {
      pointerId: 9,
      clientX: 250,
      clientY: 220,
    })
    expect(screen.getByTestId("design-selection-marquee")).toBeTruthy()
    firePointer(canvas, "pointerup", {
      pointerId: 9,
      clientX: 250,
      clientY: 220,
    })

    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "frame",
      "rectangle",
      "title",
    ])
  })
})

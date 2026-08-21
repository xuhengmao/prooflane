import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DesignDocument } from "@/lib/design/ast"
import { DesignCanvasHost } from "./design-canvas-host"

const document: DesignDocument = {
  version: 1,
  revision: "r1",
  rootId: "frame",
  nodes: [
    {
      id: "frame",
      type: "frame",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  ],
}

function renderHost() {
  const onZoomChange = vi.fn()
  const onPanChange = vi.fn()
  const onSelectNode = vi.fn()
  const onMoveNode = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DesignCanvasHost
        artifactId="artifact-1"
        view="design"
        document={document}
        zoom={1}
        panX={0}
        panY={0}
        onZoomChange={onZoomChange}
        onPanChange={onPanChange}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
        onMoveNode={onMoveNode}
      />
    </NextIntlClientProvider>
  )
  const host = screen.getByTestId("design-canvas-host")
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 700,
    width: 1000,
    height: 700,
    toJSON: () => ({}),
  })
  return { host, onZoomChange, onPanChange }
}

describe("DesignCanvasHost navigation", () => {
  it("zooms around the wheel pointer", () => {
    const { host, onZoomChange } = renderHost()

    fireEvent.wheel(host, { deltaY: -100, clientX: 300, clientY: 200 })

    expect(onZoomChange).toHaveBeenCalledWith(expect.any(Number))
  })

  it("pans with the middle button", () => {
    const { host, onPanChange } = renderHost()

    fireEvent.pointerDown(host, {
      button: 1,
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(host, {
      pointerId: 4,
      clientX: 140,
      clientY: 120,
    })
    fireEvent.pointerUp(host, {
      pointerId: 4,
      clientX: 140,
      clientY: 120,
    })

    expect(onPanChange).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number)
    )
  })

  it("offers fit and reset controls", () => {
    renderHost()

    expect(screen.getByRole("button", { name: "Fit canvas" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reset view" })).toBeTruthy()
  })
})

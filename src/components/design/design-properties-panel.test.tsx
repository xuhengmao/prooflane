import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DesignNode } from "@/lib/design/ast"
import { DesignPropertiesPanel } from "./design-properties-panel"

const textNode: DesignNode = {
  id: "title-text",
  type: "text",
  bounds: { x: 10, y: 20, width: 200, height: 40 },
  opacity: 0.8,
  text: "Hello",
  metadata: { name: "Title" },
}

function renderPanel(node: DesignNode | null, onUpdate = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DesignPropertiesPanel node={node} onUpdate={onUpdate} />
    </NextIntlClientProvider>
  )
  return onUpdate
}

describe("DesignPropertiesPanel", () => {
  it("shows a clear empty state without a selected node", () => {
    renderPanel(null)

    expect(
      screen.getByText("Select an element to inspect its properties")
    ).toBeTruthy()
    expect(screen.queryByLabelText("X position")).toBeNull()
  })

  it("shows node identity, bounds, opacity, and text", () => {
    renderPanel(textNode)

    expect(screen.getByText("Text")).toBeTruthy()
    expect(screen.getByText("title-text")).toBeTruthy()
    expect(screen.getByLabelText("X position")).toHaveValue(10)
    expect(screen.getByLabelText("Y position")).toHaveValue(20)
    expect(screen.getByLabelText("Width")).toHaveValue(200)
    expect(screen.getByLabelText("Height")).toHaveValue(40)
    expect(screen.getByLabelText("Opacity")).toHaveValue(80)
    expect(screen.getByLabelText("Text content")).toHaveValue("Hello")
  })

  it("emits commands for committed bounds and text changes", async () => {
    const user = userEvent.setup()
    const onUpdate = renderPanel(textNode)

    const x = screen.getByLabelText("X position")
    await user.clear(x)
    await user.type(x, "32")
    fireEvent.blur(x)
    expect(onUpdate).toHaveBeenCalledWith({
      type: "UpdateNode",
      id: "title-text",
      patch: { bounds: { x: 32, y: 20, width: 200, height: 40 } },
    })

    const text = screen.getByLabelText("Text content")
    await user.clear(text)
    await user.type(text, "Updated title")
    fireEvent.blur(text)
    expect(onUpdate).toHaveBeenCalledWith({
      type: "SetText",
      id: "title-text",
      text: "Updated title",
    })
  })

  it("rejects invalid sizes and opacity without emitting commands", () => {
    const onUpdate = renderPanel(textNode)

    fireEvent.change(screen.getByLabelText("Width"), {
      target: { value: "-1" },
    })
    fireEvent.blur(screen.getByLabelText("Width"))
    expect(screen.getByText("Width must be zero or greater")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "101" },
    })
    fireEvent.blur(screen.getByLabelText("Opacity"))
    expect(screen.getByText("Opacity must be between 0 and 100")).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

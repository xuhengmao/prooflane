import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import {
  ComposerRuntimeBarContent,
  isComposerRuntimeStatus,
  type ComposerRuntimeBarContentProps,
} from "./composer-runtime-bar"
import enMessages from "@/i18n/messages/en.json"

const defaultProps: ComposerRuntimeBarContentProps = {
  agentType: "claude_code",
  status: "generating",
  statusLabel: "Thinking",
  elapsedLabel: "1.2s",
  retryLabel: "Retry",
  phase: "thinking",
  editStats: { files: 0, additions: 0, deletions: 0 },
  toolCallCount: 0,
}

function renderRuntimeBar(
  overrides: Partial<ComposerRuntimeBarContentProps> = {}
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComposerRuntimeBarContent {...defaultProps} {...overrides} />
    </NextIntlClientProvider>
  )
}

describe("ComposerRuntimeBarContent", () => {
  it("shows all runtime details without placing volatile counters in aria-live", () => {
    renderRuntimeBar({
      status: "tool_running",
      statusLabel: "Calling Read",
      elapsedLabel: "1.2s",
      phase: "streaming",
      editStats: { files: 2, additions: 5, deletions: 1 },
      toolCallCount: 2,
    })

    const bar = screen.getByTestId("composer-runtime-bar")
    const liveStatus = screen.getByRole("status")

    expect(bar).toHaveAttribute("data-composer-runtime-state", "tool_running")
    expect(bar).toHaveClass("flex-wrap")
    expect(bar.querySelector('[class~="hidden"]')).toBeNull()
    expect(liveStatus).toHaveTextContent("Calling Read")
    expect(bar).toHaveTextContent("Streaming")
    expect(screen.getByTestId("composer-status-elapsed")).toHaveTextContent(
      "1.2s"
    )
    expect(liveStatus).not.toContainElement(
      screen.getByTestId("composer-status-elapsed")
    )
    expect(bar).toHaveTextContent("2F +5/-1")
    expect(bar).toHaveTextContent("2 tool uses")
    expect(screen.getByTestId("composer-runtime-agent")).toHaveClass(
      "animate-pulse",
      "motion-reduce:animate-none"
    )
  })

  it("keeps the full failure text accessible and retries once", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const error = "Connection failed while waiting for the agent"

    renderRuntimeBar({
      status: "failed",
      statusLabel: error,
      elapsedLabel: null,
      phase: null,
      onRetry,
    })

    expect(screen.getByRole("status")).toHaveTextContent(error)
    expect(screen.getByTitle(error)).toBeInTheDocument()
    expect(screen.getByTestId("composer-runtime-agent")).not.toHaveClass(
      "animate-pulse"
    )

    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe("isComposerRuntimeStatus", () => {
  it("accepts only states that need the external runtime bar", () => {
    expect(isComposerRuntimeStatus("generating")).toBe(true)
    expect(isComposerRuntimeStatus("tool_running")).toBe(true)
    expect(isComposerRuntimeStatus("waiting_for_user")).toBe(true)
    expect(isComposerRuntimeStatus("failed")).toBe(true)
    expect(isComposerRuntimeStatus("stopped")).toBe(true)
    expect(isComposerRuntimeStatus("idle")).toBe(false)
    expect(isComposerRuntimeStatus("focused")).toBe(false)
    expect(isComposerRuntimeStatus("new_empty")).toBe(false)
  })
})

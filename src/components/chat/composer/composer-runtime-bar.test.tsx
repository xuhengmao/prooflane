import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  ComposerRuntimeBarContent,
  isComposerRuntimeStatus,
  type ComposerRuntimeBarContentProps,
} from "./composer-runtime-bar"
import type { LiveTokenRateSnapshot } from "./live-token-rate"
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
  tokenRate: { tokensPerSecond: null, source: "estimated" },
}

const runtimeGridColumns = "grid-cols-[minmax(12rem,1fr)_minmax(0,auto)_auto]"

function readGlobalsCss(): string {
  return readFileSync(join(process.cwd(), "src/app/globals.css"), {
    encoding: "utf8",
  })
}

function extractCssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)

  const openingBrace = css.indexOf("{", start)
  expect(openingBrace).toBeGreaterThanOrEqual(0)

  let depth = 0
  for (let index = openingBrace; index < css.length; index++) {
    if (css[index] === "{") {
      depth += 1
    }
    if (css[index] === "}") {
      depth -= 1
    }
    if (depth === 0) {
      return css.slice(openingBrace + 1, index)
    }
  }

  throw new Error(`Unclosed CSS block for ${selector}`)
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

function makeTokenRate(
  overrides: Partial<LiveTokenRateSnapshot>
): LiveTokenRateSnapshot {
  return {
    tokensPerSecond: null,
    source: "estimated",
    ...overrides,
  }
}

describe("ComposerRuntimeBarContent", () => {
  it("shows a compact token rate without leaking token wording into the visible text", () => {
    renderRuntimeBar({
      tokenRate: makeTokenRate({ tokensPerSecond: 96, source: "estimated" }),
    })

    const rate = screen.getByTestId("composer-token-rate")
    const visibleRate = rate.querySelector('[aria-hidden="true"][dir="ltr"]')

    expect(rate).toHaveTextContent("≈96/s")
    expect(visibleRate).toHaveTextContent("≈96/s")
    expect(visibleRate).not.toHaveTextContent(/token/i)
    expect(rate).toHaveAccessibleName(
      "Estimated output speed: 96 tokens per second"
    )
    expect(rate).not.toHaveAttribute("aria-live")
  })

  it("formats pending, measured, and zero-rate states distinctly", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ComposerRuntimeBarContent
          {...defaultProps}
          tokenRate={makeTokenRate({
            tokensPerSecond: null,
            source: "estimated",
          })}
        />
      </NextIntlClientProvider>
    )

    const rate = screen.getByTestId("composer-token-rate")
    expect(rate).toHaveTextContent("--/s")

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ComposerRuntimeBarContent
          {...defaultProps}
          tokenRate={makeTokenRate({ tokensPerSecond: 96, source: "provider" })}
        />
      </NextIntlClientProvider>
    )

    expect(rate).toHaveTextContent("96/s")
    expect(rate).toHaveAccessibleName(
      "Measured output speed: 96 tokens per second"
    )

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ComposerRuntimeBarContent
          {...defaultProps}
          tokenRate={makeTokenRate({ tokensPerSecond: 0, source: "estimated" })}
        />
      </NextIntlClientProvider>
    )

    expect(rate).toHaveTextContent("0/s")
    expect(rate).toHaveAccessibleName(
      "Estimated output speed: 0 tokens per second"
    )
  })

  it("shows all runtime details without placing volatile counters in aria-live", () => {
    renderRuntimeBar({
      status: "tool_running",
      statusLabel: "Calling Read",
      elapsedLabel: "1.2s",
      phase: "streaming",
      editStats: { files: 2, additions: 5, deletions: 1 },
      toolCallCount: 2,
      tokenRate: makeTokenRate({ tokensPerSecond: 96, source: "estimated" }),
    })

    const bar = screen.getByTestId("composer-runtime-bar")
    const liveStatus = screen.getByRole("status")

    expect(bar).toHaveAttribute("data-composer-runtime-state", "tool_running")
    expect(bar).toHaveClass("min-w-0")
    expect(bar).not.toHaveClass("flex-wrap")
    expect(bar.querySelector('[class~="hidden"]')).toBeNull()
    expect(screen.getByTestId("composer-runtime-primary")).toHaveClass(
      "min-w-0"
    )
    expect(liveStatus).toHaveTextContent("Calling Read")
    expect(bar).toHaveTextContent("Streaming")
    expect(screen.getByTestId("composer-status-elapsed")).toHaveTextContent(
      "1.2s"
    )
    expect(liveStatus).not.toContainElement(
      screen.getByTestId("composer-status-elapsed")
    )
    expect(screen.getByTestId("composer-runtime-secondary")).toHaveTextContent(
      "2F +5/-1"
    )
    expect(screen.getByTestId("composer-runtime-secondary")).toHaveTextContent(
      "2 tool uses"
    )
    expect(screen.getByTestId("composer-runtime-agent")).toHaveClass(
      "animate-pulse",
      "motion-reduce:animate-none"
    )
    expect(screen.getByTestId("composer-token-rate")).not.toHaveAttribute(
      "aria-live"
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
      tokenRate: makeTokenRate({ tokensPerSecond: 96, source: "estimated" }),
    })

    expect(screen.getByRole("status")).toHaveTextContent(error)
    expect(screen.getByTitle(error)).toBeInTheDocument()
    expect(screen.queryByTestId("composer-token-rate")).not.toBeInTheDocument()
    expect(screen.getByTestId("composer-runtime-agent")).not.toHaveClass(
      "animate-pulse"
    )

    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("keeps primary details and retry available in a narrow runtime bar", () => {
    const onRetry = vi.fn()

    render(
      <div style={{ width: "18rem" }}>
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ComposerRuntimeBarContent
            {...defaultProps}
            editStats={{ files: 2, additions: 500, deletions: 100 }}
            onRetry={onRetry}
            phase="streaming"
            status="failed"
            statusLabel="Connection failed while waiting for the agent response"
            toolCallCount={20}
            tokenRate={makeTokenRate({
              tokensPerSecond: null,
              source: "estimated",
            })}
          />
        </NextIntlClientProvider>
      </div>
    )

    const bar = screen.getByTestId("composer-runtime-bar")
    const primary = screen.getByTestId("composer-runtime-primary")
    const secondary = screen.getByTestId("composer-runtime-secondary")
    const retry = screen.getByRole("button", { name: "Retry" })

    expect(primary).toContainElement(screen.getByRole("status"))
    expect(primary).toContainElement(
      screen.getByTestId("composer-status-elapsed")
    )
    expect(secondary).toHaveAttribute("data-composer-runtime-slot", "secondary")
    expect(secondary).toHaveAttribute(
      "data-composer-runtime-priority",
      "compressible"
    )
    expect(secondary).toHaveClass("min-w-0", "overflow-hidden")
    expect(
      secondary.querySelectorAll(".prooflane-composer-runtime-secondary-label")
    ).toHaveLength(2)
    expect(retry).toHaveClass("shrink-0")
    expect(retry.parentElement).toBe(bar)
  })

  it("uses a three-column layout contract that protects primary details at 24rem", () => {
    const onRetry = vi.fn()

    render(
      <div style={{ width: "24rem" }}>
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ComposerRuntimeBarContent
            {...defaultProps}
            editStats={{ files: 2, additions: 500, deletions: 100 }}
            onRetry={onRetry}
            phase="streaming"
            status="failed"
            statusLabel="Connection failed while waiting for the agent response"
            toolCallCount={20}
            tokenRate={makeTokenRate({
              tokensPerSecond: null,
              source: "estimated",
            })}
          />
        </NextIntlClientProvider>
      </div>
    )

    const bar = screen.getByTestId("composer-runtime-bar")
    const primary = screen.getByTestId("composer-runtime-primary")
    const secondary = screen.getByTestId("composer-runtime-secondary")
    const retry = screen.getByRole("button", { name: "Retry" })
    const secondaryLabels = secondary.querySelectorAll(
      ".prooflane-composer-runtime-secondary-label"
    )

    expect(bar.parentElement).toHaveStyle({ width: "24rem" })
    expect(bar).toHaveClass("grid", runtimeGridColumns)
    expect(bar).not.toHaveClass("flex")
    expect(primary).toHaveAttribute("data-composer-runtime-slot", "primary")
    expect(primary).toHaveClass("min-w-0", "overflow-hidden")
    expect(primary).not.toHaveClass("flex-1")
    expect(primary).toContainElement(screen.getByRole("status"))
    expect(primary).toContainElement(
      screen.getByTestId("composer-status-elapsed")
    )
    expect(secondary).toHaveAttribute("data-composer-runtime-slot", "secondary")
    expect(secondary).toHaveAttribute(
      "data-composer-runtime-priority",
      "compressible"
    )
    expect(secondary).toHaveClass("min-w-0", "overflow-hidden")
    expect(secondaryLabels).toHaveLength(2)
    for (const label of secondaryLabels) {
      expect(label).toHaveClass("min-w-0", "truncate")
    }
    expect(retry).toHaveAttribute("data-composer-runtime-slot", "action")
    expect(retry).toHaveClass("shrink-0")
    expect(retry.parentElement).toBe(bar)
  })

  it("compresses secondary labels in the 24rem container-query band", () => {
    const globalsCss = readGlobalsCss()
    const midWidthQuery = extractCssBlock(
      globalsCss,
      "@container (max-width: 28rem)"
    )
    const narrowQuery = extractCssBlock(
      globalsCss,
      "@container (max-width: 22rem)"
    )

    expect(midWidthQuery).toContain(
      ".prooflane-composer-runtime-secondary-label"
    )
    expect(midWidthQuery).toContain("max-width: 4.5rem;")
    expect(midWidthQuery).not.toContain("display: none")
    expect(narrowQuery).toContain(".prooflane-composer-runtime-secondary-label")
    expect(narrowQuery).toContain("display: none;")
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

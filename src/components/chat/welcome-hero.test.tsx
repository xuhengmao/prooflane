import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import zhCNMessages from "@/i18n/messages/zh-CN.json"
import { WelcomeHero } from "./welcome-hero"

function renderWelcomeHero() {
  return render(
    <NextIntlClientProvider locale="zh-CN" messages={zhCNMessages}>
      <WelcomeHero />
    </NextIntlClientProvider>
  )
}

describe("WelcomeHero", () => {
  it("renders the Prooflane identity and description", () => {
    renderWelcomeHero()

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Hello，我是prooflane",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "我是一个本地运行、安全可控、自主学习、越用越懂你的AI工作生活搭子"
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/今天准备做些什么呢/)).not.toBeInTheDocument()
  })

  it("stacks all four storyboard frames in a stable animated viewport", () => {
    const { container } = renderWelcomeHero()

    const animation = screen.getByTestId("prooflane-welcome-animation")
    const frames = Array.from(
      animation.querySelectorAll<HTMLImageElement>("img")
    )

    expect(animation).toHaveClass("aspect-[12/5]")
    expect(frames).toHaveLength(4)
    expect(frames.map((frame) => frame.getAttribute("src"))).toEqual([
      "/prooflane/welcome/index_stp_1.png",
      "/prooflane/welcome/index_stp_2.png",
      "/prooflane/welcome/index_stp_3.png",
      "/prooflane/welcome/index_stp_4.png",
    ])
    expect(frames[0]).toHaveAttribute("alt", "Prooflane 品牌动画")
    expect(frames.slice(1).every((frame) => frame.alt === "")).toBe(true)
    expect(frames.every((frame) => frame.classList.contains("absolute"))).toBe(
      true
    )
    expect(frames[0]).toHaveClass("prooflane-welcome-frame-base")
    expect(frames[0]).not.toHaveClass("prooflane-welcome-frame-overlay")
    expect(
      frames
        .slice(1)
        .every((frame) =>
          frame.classList.contains("prooflane-welcome-frame-overlay")
        )
    ).toBe(true)
    expect(container.querySelectorAll(".prooflane-welcome-frame")).toHaveLength(
      4
    )
  })
})

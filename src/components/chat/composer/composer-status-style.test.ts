import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const globalsCss = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8"
)
const statusRules = globalsCss.slice(
  globalsCss.indexOf("/* P1-02A composer status feedback."),
  globalsCss.indexOf(".codeg-composer .ProseMirror")
)
const reducedMotionRules = statusRules.slice(
  statusRules.indexOf("@media (prefers-reduced-motion: reduce)")
)
const hostStateRules = Array.from(
  statusRules.matchAll(
    /\.codeg-composer-chrome\[data-composer-state="[^"]+"\](?!::before)[\s\S]*?\n\}/g
  ),
  ([rule]) => rule
).join("\n")

describe("composer status styles", () => {
  it("defines scoped visual states without changing the composer box model", () => {
    expect(globalsCss).toContain("--prooflane-composer-status: #38BF63")
    expect(globalsCss).toContain('[data-composer-state="new_empty"]')
    expect(globalsCss).toContain('[data-composer-state="focused"]')
    expect(globalsCss).toContain('[data-composer-state="generating"]')
    expect(globalsCss).toContain('[data-composer-state="tool_running"]')
    expect(globalsCss).toContain('[data-composer-state="waiting_for_user"]')
    expect(globalsCss).toContain('[data-composer-state="failed"]')
    expect(globalsCss).toContain('[data-composer-state="stopped"]')
    expect(hostStateRules).not.toMatch(
      /(?:padding|margin|width|height|border-width):/
    )
  })

  it("uses a pseudo-element border flow and disables status motion when requested", () => {
    expect(globalsCss).toContain(
      "animation: prooflane-composer-status-breathe 2.2s ease-in-out infinite"
    )
    expect(statusRules).toContain('[data-composer-state="generating"]::before')
    expect(statusRules).toContain(
      '[data-composer-state="tool_running"]::before'
    )
    expect(statusRules).toMatch(
      /data-composer-state="focused"\][\s\S]*?box-shadow:\s*0 0 0 3px var\(--prooflane-composer-status-soft\)/
    )
    expect(statusRules).toContain(".prooflane-composer-status-dot")
    expect(globalsCss).toContain(".prooflane-composer-optimizing::after")
    expect(reducedMotionRules).toContain(
      '[data-composer-state="new_empty"]::before'
    )
    expect(reducedMotionRules).toContain("animation: none")
    expect(reducedMotionRules).toMatch(
      /\.codeg-composer-chrome\[data-composer-state\]\s*\{[\s\S]*?transition:\s*none/
    )
    expect(statusRules).not.toMatch(
      /data-composer-state="(?:waiting_for_user|failed|stopped)"::before/
    )
    expect(statusRules).not.toMatch(
      /data-composer-state="(?:generating|tool_running|waiting_for_user|failed)"[^}]*box-shadow/
    )
  })

  it("styles the external runtime bar and disables all of its motion", () => {
    expect(statusRules).toContain(".prooflane-composer-runtime-bar")
    expect(statusRules).toContain("--prooflane-composer-status: #38BF63")
    expect(statusRules).toContain(
      '.prooflane-composer-runtime-bar[data-composer-runtime-state="failed"]'
    )
    expect(statusRules).toContain(
      '.prooflane-composer-runtime-bar[data-composer-runtime-state="stopped"]'
    )
    expect(reducedMotionRules).toContain(".prooflane-composer-runtime-bar")
    expect(reducedMotionRules).toContain("animation: none")
  })
})

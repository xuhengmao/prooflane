import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

const root = process.cwd()
const upstreamUpdaterKey =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ4OEM3NkMyMTVENjdBODgKUldTSWV0WVZ3bmFNU0NnSzhpdFg2bXFmMHFidWd1eWpuZ2Y2WmU5QmVXdWVrU0ZpOCt2dnd6WW4K"

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"))
}

function collectStrings(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") {
    result.push(value)
    return result
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, result))
    return result
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, result))
  }

  return result
}

function removeCompatibilityNames(value: string): string {
  return value
    .replace(/~\/\.codeg\b/gi, "")
    .replace(/\bcodeg-(?:mcp|server)\b/gi, "")
    .replace(/\bcodeg_lib\b/gi, "")
    .replace(/\bCODEG_[A-Z0-9_]+\b/g, "")
    .replace(/\bcodeg:\/\/[^\s]*/gi, "")
    .replace(/\[providers\.codeg\]/gi, "")
    .replace(/\bcodeg(?:\.zip|bak)\b/gi, "")
}

describe("Prooflane brand configuration", () => {
  it("declares the macOS microphone usage purpose for voice input", () => {
    const infoPlist = readFileSync(
      path.join(root, "src-tauri/Info.plist"),
      "utf8"
    )

    expect(infoPlist).toContain("<key>NSMicrophoneUsageDescription</key>")
    expect(infoPlist).toContain("语音")
  })
  test("uses independent package and desktop identities", () => {
    const packageJson = readJson("package.json") as { name: string }
    const tauri = readJson("src-tauri/tauri.conf.json") as {
      productName: string
      identifier: string
    }
    const cargo = readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8")

    expect(packageJson.name).toBe("prooflane")
    expect(tauri.productName).toBe("Prooflane")
    expect(tauri.identifier).toBe("io.github.xuhengmao.prooflane")
    expect(cargo).toMatch(/^name = "prooflane"$/m)
    expect(cargo).toMatch(/\[\[bin\]\]\s+name = "prooflane"/m)
  })

  test("keeps the macOS notification identifier portable across Tauri builds", () => {
    const notification = readFileSync(
      path.join(root, "src-tauri/src/commands/notification.rs"),
      "utf8"
    )

    expect(notification).toContain("app.config().identifier.as_str()")
    expect(notification).not.toContain("use tauri::Manager;")
  })

  test("uses the Prooflane release channel and a dedicated updater key", () => {
    const tauri = readJson("src-tauri/tauri.conf.json") as {
      plugins: { updater: { pubkey: string; endpoints: string[] } }
    }

    expect(tauri.plugins.updater.endpoints).toEqual([
      "https://github.com/xuhengmao/prooflane/releases/latest/download/latest.json",
    ])
    expect(tauri.plugins.updater.pubkey).not.toBe(upstreamUpdaterKey)
    expect(tauri.plugins.updater.pubkey.length).toBeGreaterThan(80)
  })

  test("does not expose the upstream product brand in translated UI copy", () => {
    const messagesDir = path.join(root, "src/i18n/messages")
    const offenders = readdirSync(messagesDir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        const strings = collectStrings(readJson(`src/i18n/messages/${name}`))
        return strings
          .filter((value) => /\bcodeg/i.test(removeCompatibilityNames(value)))
          .map((value) => `${name}: ${value}`)
      })

    expect(offenders).toEqual([])
  })

  test("does not expose the upstream brand in user-facing source strings", () => {
    const sourceFiles = [
      "src/components/settings/add-github-account-dialog.tsx",
      "src/contexts/git-credential-context.tsx",
      "src-tauri/src/acp/connection.rs",
      "src-tauri/src/acp/delegation/tool_schema.json",
      "src-tauri/src/acp/preflight.rs",
      "src-tauri/src/automation/engine.rs",
      "src-tauri/src/commands/acp.rs",
      "src-tauri/src/commands/backup/mod.rs",
      "src-tauri/src/commands/chat_authoring.rs",
      "src-tauri/src/commands/custom_agents.rs",
      "src-tauri/src/commands/office_tools.rs",
      "src-tauri/src/commands/version_control.rs",
      "src-tauri/src/commands/windows.rs",
      "src-tauri/src/work_task/engine.rs",
    ]
    const forbiddenPhrases = [
      '.title("codeg pet")',
      '.title("codeg sessions")',
      'description: "codeg"',
      '.header("user-agent", "codeg")',
      '.name("codeg")',
      "recognized codeg backup",
      "version of codeg",
      "codeg image",
      "official installer and codeg",
      "built into codeg",
      "known to codeg",
      "codeg's settings",
      "codeg launches",
      "codeg never launches",
      "codeg could not parse",
      "codeg-managed download",
      "codeg's acp schema",
      "reinstall codeg or set",
      "codeg picks up a",
      "another codeg process owns",
      "codeg's internal conversation id",
      "save a codeg automation",
      "codeg runs on",
      "open in codeg",
      "codeg's to-dos",
    ]
    const source = sourceFiles
      .map((relativePath) =>
        readFileSync(path.join(root, relativePath), "utf8").toLowerCase()
      )
      .join("\n")
    const offenders = forbiddenPhrases.filter((phrase) =>
      source.includes(phrase.toLowerCase())
    )

    expect(offenders).toEqual([])
  })
})

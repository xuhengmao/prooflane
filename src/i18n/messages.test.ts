import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import ar from "./messages/ar.json"
import de from "./messages/de.json"
import en from "./messages/en.json"
import es from "./messages/es.json"
import fr from "./messages/fr.json"
import ja from "./messages/ja.json"
import ko from "./messages/ko.json"
import pt from "./messages/pt.json"
import zhCN from "./messages/zh-CN.json"
import zhTW from "./messages/zh-TW.json"

type MessageNode = string | { [key: string]: MessageNode }

function collectKeys(node: MessageNode, prefix = ""): string[] {
  if (typeof node === "string") {
    return [prefix]
  }
  const out: string[] = []
  for (const [key, value] of Object.entries(node)) {
    const next = prefix ? `${prefix}.${key}` : key
    out.push(...collectKeys(value, next))
  }
  return out
}

const reference = new Set(collectKeys(en as MessageNode))
const locales = [
  ["ar", ar],
  ["de", de],
  ["en", en],
  ["es", es],
  ["fr", fr],
  ["ja", ja],
  ["ko", ko],
  ["pt", pt],
  ["zh-CN", zhCN],
  ["zh-TW", zhTW],
] as const

const relayErrorCodes = [
  "relay_disabled",
  "relay_source_not_found",
  "relay_source_unavailable",
  "relay_rounds_changed",
  "relay_scope_empty",
  "relay_budget_exceeded",
  "relay_summary_unavailable",
  "relay_summary_invalid",
  "relay_summary_input_too_large",
  "relay_model_changed",
  "relay_consume_conflict",
  "relay_send_uncertain",
  "relay_immutable_snapshot",
] as const

const requiredReadmeClaims = [
  "主动接力",
  "跨智能体",
  "范围预览",
  "Token 预算",
  "来源追溯",
  "默认不会读取全部历史会话",
  "默认不会写入长期记忆",
]

// `en.json` is the source of truth. Any missing key in another locale fails
// the test with the exact dotted path, making translation gaps grep-able.
describe("i18n locale key parity vs en.json", () => {
  it.each(locales.filter(([locale]) => locale !== "en"))(
    "%s has the same key set as en",
    (_locale, messages) => {
      const localeKeys = new Set(collectKeys(messages as MessageNode))
      const missing = [...reference].filter((k) => !localeKeys.has(k))
      const extra = [...localeKeys].filter((k) => !reference.has(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    }
  )

  it.each(locales)(
    "%s preserves the tool-name placeholder",
    (_locale, messages) => {
      expect(messages.Folder.chat.messageInput.statusToolRunning).toContain(
        "{tool}"
      )
    }
  )
})

describe("conversation relay release copy", () => {
  it("defines the required relay keys in the zh-CN reference locale", () => {
    const referenceRelay = (zhCN as Record<string, unknown>).Folder as {
      chat?: { relay?: { errors?: Record<string, string> } }
    }
    const referenceCapabilities = (zhCN as Record<string, unknown>)
      .ConversationCapabilities
    const referenceNav = (zhCN as Record<string, unknown>).SettingsShell as {
      nav?: { conversation_capabilities?: string }
    }

    expect(referenceNav.nav?.conversation_capabilities).toEqual(
      expect.any(String)
    )
    expect(referenceCapabilities).toEqual(expect.any(Object))
    expect(referenceRelay.chat?.relay).toEqual(expect.any(Object))
    expect(
      Object.keys(referenceRelay.chat?.relay?.errors ?? {}).sort()
    ).toEqual([...relayErrorCodes].sort())
  })

  it.each(locales)(
    "%s matches the zh-CN conversation relay key sets",
    (_locale, messages) => {
      const referenceMessages = zhCN as MessageNode
      const localeMessages = messages as MessageNode
      const referenceFolder = (referenceMessages as Record<string, MessageNode>)
        .Folder as Record<string, MessageNode>
      const localeFolder = (localeMessages as Record<string, MessageNode>)
        .Folder as Record<string, MessageNode>
      const referenceChat = referenceFolder.chat as Record<string, MessageNode>
      const localeChat = localeFolder.chat as Record<string, MessageNode>
      const referenceRelay = referenceChat.relay
      const localeRelay = localeChat.relay

      const referenceCapabilities = (
        referenceMessages as Record<string, MessageNode>
      ).ConversationCapabilities
      const localeCapabilities = (localeMessages as Record<string, MessageNode>)
        .ConversationCapabilities

      expect(
        collectKeys(referenceCapabilities, "ConversationCapabilities").sort()
      ).toEqual(
        collectKeys(localeCapabilities, "ConversationCapabilities").sort()
      )
      expect(collectKeys(referenceRelay, "Folder.chat.relay").sort()).toEqual(
        collectKeys(localeRelay, "Folder.chat.relay").sort()
      )
    }
  )

  it("documents the controllable relay guarantees in README", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8")

    for (const claim of requiredReadmeClaims) {
      expect(readme).toContain(claim)
    }
  })
})

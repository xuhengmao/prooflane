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

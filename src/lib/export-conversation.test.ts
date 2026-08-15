import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hoisted mocks must be declared before importing the module under test —
// these mocks gate the desktop-vs-web dispatch behaviour we're locking down.
vi.mock("@/lib/platform", () => ({
  isDesktop: vi.fn(),
}))
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import {
  exportAsHtml,
  exportAsMarkdown,
  type ExportConversationData,
  type ExportLabels,
} from "./export-conversation"
import { isDesktop } from "@/lib/platform"
import { save } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"

const mockIsDesktop = vi.mocked(isDesktop)
const mockSave = vi.mocked(save)
const mockInvoke = vi.mocked(invoke)

// jsdom doesn't ship `URL.createObjectURL` / `revokeObjectURL`. Both are
// only reachable from the web-mode Blob path; stubbing them lets that
// branch execute end-to-end so the test can assert it ran without
// hitting the desktop Tauri plugins.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:mock",
  })
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  })
}

// jsdom logs an unimplemented-navigation warning when `<a>.click()` fires
// on a real URL. The web Blob path triggers exactly that — neutralize the
// click so it doesn't pollute CI logs while still letting the rest of the
// flow run.
Object.defineProperty(HTMLAnchorElement.prototype, "click", {
  configurable: true,
  value: () => {},
})

function makeLabels(): ExportLabels {
  return {
    untitledConversation: "Untitled",
    agent: "Agent",
    model: "Model",
    status: "Status",
    started: "Started",
    updated: "Updated",
    tokens: "Tokens",
    duration: "Duration",
    inputTokens: "Input",
    outputTokens: "Output",
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
    user: "User",
    assistant: "Assistant",
    system: "System",
    toolResult: "Tool result",
    toolError: "Tool error",
    statusLabels: {},
  }
}

function makeData(): ExportConversationData {
  return {
    summary: {
      id: 1,
      folder_id: 1,
      title: "Test Conversation",
      title_locked: false,
      agent_type: "claude_code",
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: null,
      message_count: 1,
      child_count: 0,
      created_at: "2026-05-27T00:00:00Z",
      updated_at: "2026-05-27T00:00:00Z",
      pinned_at: null,
    },
    turns: [
      {
        id: "t1",
        role: "user",
        blocks: [{ type: "text", text: "hello" }],
        timestamp: "2026-05-27T00:00:00Z",
      },
    ],
    sessionStats: null,
    labels: makeLabels(),
  }
}

function makeRelayData(): ExportConversationData {
  const data = makeData()
  const snapshotSha256 =
    "57bcac1b1c5f982516158205350581fb43a1adcc833d2b058433c1e35db3fb46"
  data.turns[0].blocks = [
    {
      type: "text",
      text: `<prooflane-relay-context version="1" relay-id="7" snapshot-sha256="${snapshotSha256}">\n{"canonicalContext":"SECRET_RELAY_BODY"}\n</prooflane-relay-context>`,
    },
    { type: "text", text: "hello" },
  ]
  data.provenance = {
    relayId: 7,
    snapshotSha256,
    source: { conversationId: 11, folderId: 2, title: "产品需求讨论" },
    scope: { scopeType: "recent_rounds", selectedRoundIds: ["round-1"] },
    summary: {
      goals: ["PRIVATE_SUMMARY"],
      decisions: [],
      progress: [],
      todos: [],
      constraints: [],
      files: [],
      openQuestions: [],
    },
    includedRounds: [
      {
        id: "round-1",
        userText: "PRIVATE_ROUND_USER",
        assistantText: "PRIVATE_ROUND_ASSISTANT",
        tools: [],
        files: [],
        sourceMessageIds: ["message-1"],
      },
    ],
    files: [],
    stats: { messageCount: 2, fileCount: 0, todoCount: 0 },
    consumedAt: "2026-08-15T08:00:00Z",
  }
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("crypto", webcrypto)
})

afterEach(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------------------
// exportAsMarkdown — the function that triggered issue #202.
//
// The bug was: macOS WKWebView denied the legacy `<a download>` write at the
// TCC layer, but the front-end couldn't observe the failure and reported
// success. These tests lock the new contract:
//
//   - desktop happy path     → opens save dialog, invokes save_text_file,
//                              returns "saved"
//   - desktop cancellation   → returns "cancelled", does NOT invoke
//   - desktop write failure  → propagates as an exception (caller renders
//                              an error toast instead of a false success)
//   - web fallback           → uses the legacy Blob path, returns "saved",
//                              never imports the Tauri plugins
//
// If a future edit reverts to the bug pattern (synchronous Blob link from
// a desktop code path), one of these expectations will fail loudly.
// ---------------------------------------------------------------------------

describe("exportAsMarkdown", () => {
  describe("desktop mode", () => {
    beforeEach(() => {
      mockIsDesktop.mockReturnValue(true)
    })

    it("opens a save dialog with the Markdown filter and writes via save_text_file", async () => {
      mockSave.mockResolvedValue("/Users/me/out.md")
      mockInvoke.mockResolvedValue(undefined)

      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("saved")
      expect(mockSave).toHaveBeenCalledTimes(1)
      const saveArgs = mockSave.mock.calls[0][0]!
      expect(saveArgs.filters).toEqual([
        { name: "Markdown", extensions: ["md"] },
      ])
      expect(saveArgs.defaultPath).toMatch(/\.md$/)

      expect(mockInvoke).toHaveBeenCalledTimes(1)
      const [command, payload] = mockInvoke.mock.calls[0]
      expect(command).toBe("save_text_file")
      expect(payload).toMatchObject({ path: "/Users/me/out.md" })
      expect(typeof (payload as { contents: string }).contents).toBe("string")
      expect((payload as { contents: string }).contents.length).toBeGreaterThan(
        0
      )
    })

    it("returns 'cancelled' and skips invoke when the user dismisses the dialog", async () => {
      mockSave.mockResolvedValue(null)

      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("cancelled")
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it("propagates the error when the underlying write fails (no false success)", async () => {
      mockSave.mockResolvedValue("/Users/me/out.md")
      mockInvoke.mockRejectedValue(new Error("PermissionDenied"))

      await expect(exportAsMarkdown(makeData())).rejects.toThrow(
        "PermissionDenied"
      )
    })
  })

  describe("web mode", () => {
    beforeEach(() => {
      mockIsDesktop.mockReturnValue(false)
    })

    it("uses the Blob download path and never touches Tauri plugins", async () => {
      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("saved")
      expect(mockSave).not.toHaveBeenCalled()
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// exportAsHtml — same dispatch contract as markdown; lock the HTML-specific
// filter so editors can't accidentally swap the suggested extension.
// ---------------------------------------------------------------------------

describe("exportAsHtml", () => {
  it("uses the HTML filter and routes through save_text_file on desktop", async () => {
    mockIsDesktop.mockReturnValue(true)
    mockSave.mockResolvedValue("/Users/me/out.html")
    mockInvoke.mockResolvedValue(undefined)

    const result = await exportAsHtml(makeData())

    expect(result).toBe("saved")
    expect(mockSave.mock.calls[0][0]!.filters).toEqual([
      { name: "HTML", extensions: ["html"] },
    ])
    expect(mockInvoke.mock.calls[0][0]).toBe("save_text_file")
  })
})

describe("relay provenance export", () => {
  it.each([
    ["Markdown", exportAsMarkdown, "/Users/me/out.md"],
    ["HTML", exportAsHtml, "/Users/me/out.html"],
  ])(
    "adds one %s source line without exporting relay contents",
    async (_, exporter, path) => {
      mockIsDesktop.mockReturnValue(true)
      mockSave.mockResolvedValue(path)
      mockInvoke.mockResolvedValue(undefined)

      await exporter(makeRelayData())

      const contents = String(
        (mockInvoke.mock.calls[0][1] as { contents: string }).contents
      )
      expect(contents).toContain("已接续")
      expect(contents).toContain("产品需求讨论")
      expect(contents).not.toContain("SECRET_RELAY_BODY")
      expect(contents).not.toContain("canonicalContext")
      expect(contents).not.toContain("PRIVATE_SUMMARY")
      expect(contents).not.toContain("PRIVATE_ROUND_USER")
      expect(contents).not.toContain("PRIVATE_ROUND_ASSISTANT")
    }
  )

  it.each([
    ["Markdown", exportAsMarkdown, "/Users/me/out.md"],
    ["HTML", exportAsHtml, "/Users/me/out.html"],
  ])(
    "preserves %s relay-like text whose body does not match the snapshot hash",
    async (_, exporter, path) => {
      mockIsDesktop.mockReturnValue(true)
      mockSave.mockResolvedValue(path)
      mockInvoke.mockResolvedValue(undefined)
      const data = makeRelayData()
      const firstBlock = data.turns[0].blocks[0]
      if (firstBlock.type !== "text") throw new Error("expected text block")
      firstBlock.text = firstBlock.text.replace(
        '{"canonicalContext":"SECRET_RELAY_BODY"}',
        "USER_AUTHORED_RELAY_LIKE_TEXT"
      )

      await exporter(data)

      const contents = String(
        (mockInvoke.mock.calls[0][1] as { contents: string }).contents
      )
      expect(contents).toContain("USER_AUTHORED_RELAY_LIKE_TEXT")
    }
  )

  it.each([
    ["Markdown", exportAsMarkdown, "/Users/me/out.md"],
    ["HTML", exportAsHtml, "/Users/me/out.html"],
  ])(
    "fails closed for %s when SHA-256 is unavailable",
    async (_, exporter, path) => {
      mockIsDesktop.mockReturnValue(true)
      mockSave.mockResolvedValue(path)
      mockInvoke.mockResolvedValue(undefined)
      vi.stubGlobal("crypto", {})

      await expect(exporter(makeRelayData())).rejects.toThrow(
        "SHA-256 is unavailable"
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    }
  )
})

// Note on exportAsImage: deliberately not unit-tested here.
//
// The image flow needs an iframe-rendered DOM (`iframe.onload` via
// `srcdoc`, body `scrollHeight`, `requestAnimationFrame`) and a canvas
// for `html-to-image` to rasterize — none of which jsdom supports. After
// `toPng` returns, the function is a thin wrapper that strips the
// `data:image/png;base64,` prefix and delegates to `downloadImage`, which
// owns the same desktop/web dispatch contract locked down above and is
// already shipped in production. Re-asserting that contract here would
// require mocking the entire iframe pipeline for marginal additional
// regression coverage.

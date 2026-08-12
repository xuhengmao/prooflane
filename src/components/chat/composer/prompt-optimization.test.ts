import type { JSONContent } from "@tiptap/core"
import type { PromptOptimizationProvider } from "@/components/chat/composer/prompt-optimization"
import {
  LocalPromptOptimizationProvider,
  PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS,
  PROMPT_OPTIMIZATION_TIMEOUT_MS,
  editablePromptCharacterCount,
  hasEditablePromptText,
  optimizeComposerDocument,
} from "@/components/chat/composer/prompt-optimization"

describe("optimizeComposerDocument", () => {
  it("optimizes editable prose without sending or changing code and references", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "请你帮我  帮我分析一下这个问题。" },
            {
              type: "reference",
              attrs: { refType: "file", uri: "file:///a.ts" },
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const  value =  1" }],
        },
      ],
    }
    const provider = new LocalPromptOptimizationProvider()

    const result = await optimizeComposerDocument(doc, provider)

    expect(result.document.content?.[0]?.content?.[0]?.text).toBe(
      "请分析这个问题。"
    )
    expect(result.document.content?.[0]?.content?.[1]).toEqual(
      doc.content?.[0]?.content?.[1]
    )
    expect(result.document.content?.[1]).toEqual(doc.content?.[1])
    expect(result.beforeCharacters).toBeGreaterThan(result.afterCharacters)
  })

  it("does not mutate the original editor document", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "  hello   world  " }],
        },
      ],
    }
    const snapshot = structuredClone(doc)

    await optimizeComposerDocument(doc, new LocalPromptOptimizationProvider())

    expect(doc).toEqual(snapshot)
  })

  it("keeps separators between adjacent formatted text nodes", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello " },
            { type: "text", marks: [{ type: "bold" }], text: "world" },
          ],
        },
      ],
    }

    const result = await optimizeComposerDocument(
      doc,
      new LocalPromptOptimizationProvider()
    )

    expect(result.document.content?.[0]?.content).toEqual([
      { type: "text", text: "hello " },
      { type: "text", marks: [{ type: "bold" }], text: "world" },
    ])
  })

  it("keeps whitespace-only separators without sending them to the provider", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async (text) => text.toUpperCase()),
    }
    const result = await optimizeComposerDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hello" },
              { type: "text", marks: [{ type: "italic" }], text: " " },
              { type: "text", text: "world" },
            ],
          },
        ],
      },
      provider
    )

    expect(result.document.content?.[0]?.content?.[1]?.text).toBe(" ")
    expect(provider.optimize).toHaveBeenCalledTimes(2)
  })

  it("rejects an empty provider result without mutating the original", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "keep me" }] },
      ],
    }

    const snapshot = structuredClone(doc)
    const pending = optimizeComposerDocument(doc, {
      optimize: vi.fn(async () => ""),
    })

    await expect(pending).rejects.toMatchObject({ code: "empty_output" })
    expect(doc).toEqual(snapshot)
  })

  it("aborts sibling provider requests when one text node fails", async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined
    let resolveSecondStarted: (() => void) | undefined
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve
    })
    const siblingAborted = vi.fn()
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn((text, signal) => {
        if (text === "first") {
          return new Promise<string>((_resolve, reject) => {
            rejectFirst = reject
          })
        }

        resolveSecondStarted?.()
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              siblingAborted()
              reject(new DOMException("Aborted", "AbortError"))
            },
            { once: true }
          )
        })
      }),
    }
    const pending = optimizeComposerDocument(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "first" }] },
          { type: "paragraph", content: [{ type: "text", text: "second" }] },
        ],
      },
      provider
    )

    await secondStarted
    rejectFirst?.(new Error("provider failed"))

    await expect(pending).rejects.toThrow("provider failed")
    expect(siblingAborted).toHaveBeenCalledOnce()
  })

  it("counts only text that the optimizer is allowed to rewrite", () => {
    expect(
      editablePromptCharacterCount({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "reference", attrs: { uri: "file:///a.ts" } },
              { type: "text", text: "editable" },
            ],
          },
          {
            type: "codeBlock",
            content: [{ type: "text", text: "protected" }],
          },
        ],
      })
    ).toBe("editable".length)
  })

  it("does not treat whitespace or protected nodes as optimizable text", () => {
    expect(
      hasEditablePromptText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "   \n" },
              { type: "reference", attrs: { uri: "file:///a.ts" } },
            ],
          },
          {
            type: "codeBlock",
            content: [{ type: "text", text: "protected" }],
          },
        ],
      })
    ).toBe(false)
  })

  it("times out even when the provider ignores the abort signal", async () => {
    vi.useFakeTimers()
    try {
      const pending = optimizeComposerDocument(
        {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "wait" }] },
          ],
        },
        { optimize: vi.fn(() => new Promise<string>(() => {})) }
      )
      const rejection = expect(pending).rejects.toMatchObject({
        code: "timeout",
      })

      await vi.advanceTimersByTimeAsync(PROMPT_OPTIMIZATION_TIMEOUT_MS)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects an optimized result above the output character limit", async () => {
    const pending = optimizeComposerDocument(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "short" }] },
        ],
      },
      {
        optimize: vi.fn(async () =>
          "x".repeat(PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS + 1)
        ),
      }
    )

    await expect(pending).rejects.toMatchObject({ code: "output_too_long" })
  })
})

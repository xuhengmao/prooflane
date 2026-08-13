import type { JSONContent } from "@tiptap/core"
import type {
  PromptOptimizationContext,
  PromptOptimizationProvider,
} from "@/components/chat/composer/prompt-optimization"
import {
  PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS,
  PROMPT_OPTIMIZATION_TIMEOUT_MS,
  editablePromptCharacterCount,
  hasEditablePromptText,
  optimizeComposerDocument,
} from "@/components/chat/composer/prompt-optimization"

const CONTEXT: PromptOptimizationContext = {
  workspacePath: "C:/repo",
  conversationHistory: [
    { role: "user", text: "先检查登录模块" },
    { role: "assistant", text: "登录模块使用 OAuth。" },
  ],
  relatedFiles: ["src/auth.ts"],
}

describe("optimizeComposerDocument", () => {
  it("sends the complete editable draft and context to the provider exactly once", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        async () =>
          "{{PROOFLANE_SEGMENT_0_START}}\n目标：定位登录失败原因\n{{PROOFLANE_SEGMENT_0_END}}\n{{PROOFLANE_SEGMENT_1_START}}\n要求：给出可验证修复\n{{PROOFLANE_SEGMENT_1_END}}"
      ),
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "检查登录失败" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "修复后补充测试" }],
        },
      ],
    }

    await optimizeComposerDocument(doc, provider, CONTEXT)

    expect(provider.optimize).toHaveBeenCalledOnce()
    expect(provider.optimize).toHaveBeenCalledWith(
      {
        text: "{{PROOFLANE_SEGMENT_0_START}}\n检查登录失败\n{{PROOFLANE_SEGMENT_0_END}}\n{{PROOFLANE_SEGMENT_1_START}}\n修复后补充测试\n{{PROOFLANE_SEGMENT_1_END}}",
        context: CONTEXT,
      },
      expect.any(AbortSignal)
    )
  })

  it("writes each optimized line as a paragraph and preserves protected nodes in place", async () => {
    const expertReference = {
      type: "reference",
      attrs: {
        refType: "skill",
        label: "reviewer",
        meta: { scope: "expert" },
      },
    }
    const fileReference = {
      type: "reference",
      attrs: { refType: "file", uri: "file:///C:/repo/src/auth.ts" },
    }
    const codeBlock = {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const  value =  1" }],
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [expertReference, { type: "text", text: "模糊需求" }],
        },
        codeBlock,
        {
          type: "paragraph",
          content: [{ type: "text", text: "补充要求" }, fileReference],
        },
      ],
    }
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        async () =>
          "{{PROOFLANE_SEGMENT_0_START}}\n{{PROOFLANE_PROTECTED_0}}目标：定位问题\n{{PROOFLANE_SEGMENT_0_END}}\n{{PROOFLANE_SEGMENT_1_START}}\n要求：补充回归测试{{PROOFLANE_PROTECTED_1}}\n{{PROOFLANE_SEGMENT_1_END}}"
      ),
    }

    const result = await optimizeComposerDocument(doc, provider, CONTEXT)

    expect(result.document.content).toEqual([
      {
        type: "paragraph",
        content: [expertReference, { type: "text", text: "目标：定位问题" }],
      },
      codeBlock,
      {
        type: "paragraph",
        content: [{ type: "text", text: "要求：补充回归测试" }, fileReference],
      },
    ])
    expect(doc.content?.[0]?.content?.[1]?.text).toBe("模糊需求")
  })

  it("does not spend an optimized line on a reference-only paragraph", async () => {
    const referenceOnly = {
      type: "paragraph",
      content: [
        {
          type: "reference",
          attrs: { refType: "skill", label: "reviewer" },
        },
      ],
    }
    const result = await optimizeComposerDocument(
      {
        type: "doc",
        content: [
          referenceOnly,
          {
            type: "paragraph",
            content: [{ type: "text", text: "模糊需求" }],
          },
        ],
      },
      {
        optimize: vi.fn(
          async () =>
            "{{PROOFLANE_SEGMENT_0_START}}\n目标：定位问题\n{{PROOFLANE_SEGMENT_0_END}}"
        ),
      },
      CONTEXT
    )

    expect(result.document.content).toEqual([
      referenceOnly,
      {
        type: "paragraph",
        content: [{ type: "text", text: "目标：定位问题" }],
      },
    ])
  })

  it("keeps a reference at its semantic position inside an optimized paragraph", async () => {
    const reference = {
      type: "reference",
      attrs: { refType: "conversation", label: "登录排查" },
    }
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async ({ text }) =>
        text.replace("检查", "请检查").replace("问题", "根因")
      ),
    }

    const result = await optimizeComposerDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "检查 " },
              reference,
              { type: "text", text: " 中的问题" },
            ],
          },
        ],
      },
      provider,
      CONTEXT
    )

    expect(provider.optimize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(
          /^\{\{PROOFLANE_SEGMENT_0_START\}\}\n检查 \{\{PROOFLANE_PROTECTED_0\}\} 中的问题\n\{\{PROOFLANE_SEGMENT_0_END\}\}$/
        ),
      }),
      expect.any(AbortSignal)
    )
    expect(result.document.content?.[0]?.content).toEqual([
      { type: "text", text: "请检查 " },
      reference,
      { type: "text", text: " 中的根因" },
    ])
  })

  it("preserves hard breaks when sending a multiline paragraph to the provider", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async ({ text }) => text),
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "目标：修复登录" },
            { type: "hardBreak" },
            { type: "text", text: "约束：不要修改 API" },
          ],
        },
      ],
    }

    const result = await optimizeComposerDocument(doc, provider, CONTEXT)

    expect(provider.optimize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "{{PROOFLANE_SEGMENT_0_START}}\n目标：修复登录\n约束：不要修改 API\n{{PROOFLANE_SEGMENT_0_END}}",
      }),
      expect.any(AbortSignal)
    )
    expect(result.document).toEqual(doc)
  })

  it("keeps later referenced paragraphs aligned when an earlier paragraph expands to multiple lines", async () => {
    const reference = {
      type: "reference",
      attrs: { refType: "file", uri: "file:///C:/repo/src/auth.ts" },
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "修复登录" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "检查 " },
            reference,
            { type: "text", text: " 的回归测试" },
          ],
        },
      ],
    }
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        async () =>
          "{{PROOFLANE_SEGMENT_0_START}}\n目标：定位登录失败根因\n约束：保持现有 API 兼容\n{{PROOFLANE_SEGMENT_0_END}}\n{{PROOFLANE_SEGMENT_1_START}}\n验证 {{PROOFLANE_PROTECTED_0}} 的登录回归测试\n{{PROOFLANE_SEGMENT_1_END}}"
      ),
    }

    const result = await optimizeComposerDocument(doc, provider, CONTEXT)

    expect(result.document.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "目标：定位登录失败根因" },
          { type: "hardBreak" },
          { type: "text", text: "约束：保持现有 API 兼容" },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "验证 " },
          reference,
          { type: "text", text: " 的登录回归测试" },
        ],
      },
    ])
  })

  it("rejects the whole result when segment markers are missing or duplicated", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "保留第一段" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "保留第二段" }],
        },
      ],
    }
    const snapshot = structuredClone(doc)

    await expect(
      optimizeComposerDocument(
        doc,
        {
          optimize: vi.fn(
            async () =>
              "{{PROOFLANE_SEGMENT_0_START}}\n只返回第一段\n{{PROOFLANE_SEGMENT_0_END}}\n{{PROOFLANE_SEGMENT_0_START}}\n重复第一段\n{{PROOFLANE_SEGMENT_0_END}}"
          ),
        },
        CONTEXT
      )
    ).rejects.toMatchObject({ code: "invalid_output" })
    expect(doc).toEqual(snapshot)
  })

  it("rejects the whole result when a protected placeholder is changed", async () => {
    const reference = {
      type: "reference",
      attrs: { refType: "file", uri: "file:///C:/repo/src/auth.ts" },
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "检查 " },
            reference,
            { type: "text", text: " 的问题" },
          ],
        },
      ],
    }
    const snapshot = structuredClone(doc)

    await expect(
      optimizeComposerDocument(
        doc,
        {
          optimize: vi.fn(
            async () =>
              "{{PROOFLANE_SEGMENT_0_START}}\n检查 {{PROOFLANE_PROTECTED_1}} 的根因\n{{PROOFLANE_SEGMENT_0_END}}"
          ),
        },
        CONTEXT
      )
    ).rejects.toMatchObject({ code: "invalid_output" })
    expect(doc).toEqual(snapshot)
  })

  it("rejects the whole result when protected placeholders change order", async () => {
    const firstReference = {
      type: "reference",
      attrs: { refType: "file", uri: "file:///C:/repo/src/first.ts" },
    }
    const secondReference = {
      type: "reference",
      attrs: { refType: "file", uri: "file:///C:/repo/src/second.ts" },
    }
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "先检查 " },
            firstReference,
            { type: "text", text: "，再检查 " },
            secondReference,
          ],
        },
      ],
    }

    await expect(
      optimizeComposerDocument(
        doc,
        {
          optimize: vi.fn(
            async () =>
              "{{PROOFLANE_SEGMENT_0_START}}\n先检查 {{PROOFLANE_PROTECTED_1}}，再检查 {{PROOFLANE_PROTECTED_0}}\n{{PROOFLANE_SEGMENT_0_END}}"
          ),
        },
        CONTEXT
      )
    ).rejects.toMatchObject({ code: "invalid_output" })
  })

  it("passes cancellation to the default agent provider", async () => {
    const controller = new AbortController()
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn((_request, signal) => {
        expect(signal.aborted).toBe(false)
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
      }),
    }
    const pending = optimizeComposerDocument(
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "wait" }] },
        ],
      },
      provider,
      CONTEXT,
      controller.signal
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: "aborted" })
  })

  it("rejects an empty provider result without mutating the original", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "keep me" }] },
      ],
    }
    const snapshot = structuredClone(doc)

    await expect(
      optimizeComposerDocument(
        doc,
        { optimize: vi.fn(async () => "") },
        CONTEXT
      )
    ).rejects.toMatchObject({ code: "empty_output" })
    expect(doc).toEqual(snapshot)
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
        { optimize: vi.fn(() => new Promise<string>(() => {})) },
        CONTEXT
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
      },
      CONTEXT
    )

    await expect(pending).rejects.toMatchObject({ code: "output_too_long" })
  })
})

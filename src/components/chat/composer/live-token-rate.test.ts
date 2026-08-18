import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"

import {
  LiveTokenRateSampler,
  estimateVisibleTokens,
  extractVisibleAssistantText,
} from "./live-token-rate"

function message(
  role: LiveMessage["role"],
  content: LiveContentBlock[]
): LiveMessage {
  return {
    id: `${role}-1`,
    role,
    startedAt: 1,
    content,
  }
}

describe("estimateVisibleTokens", () => {
  it("counts CJK characters directly and batches non-whitespace text after concatenation", () => {
    expect(estimateVisibleTokens("你好 world")).toBe(2 + Math.ceil(5 / 4))
    expect(estimateVisibleTokens("const x = 1")).toBe(
      Math.ceil("constx=1".length / 4)
    )
    expect(estimateVisibleTokens("こんにちは 한글")).toBe(5 + 2)
    expect(estimateVisibleTokens("  \n\t")).toBe(0)
  })

  it("counts Han script ranges and Japanese/Korean scripts directly", () => {
    expect(estimateVisibleTokens("𠀀豈")).toBe(2)
    expect(estimateVisibleTokens("あア가")).toBe(3)
    expect(estimateVisibleTokens("ab𠀀 cd")).toBe(
      1 + Math.ceil("abcd".length / 4)
    )
  })
})

describe("extractVisibleAssistantText", () => {
  it("joins only visible assistant text and excludes thinking/tool content", () => {
    expect(
      extractVisibleAssistantText({
        id: "m1",
        role: "assistant",
        startedAt: 1,
        content: [
          { type: "text", text: "visible" },
          { type: "thinking", text: "hidden" },
          { type: "text", text: " text" },
          {
            type: "tool_call",
            info: {
              tool_call_id: "tool-1",
              title: "Run",
              kind: "tool",
              status: "pending",
              content: null,
              raw_input: null,
              raw_output_chunks: [],
              raw_output_total_bytes: 0,
              locations: null,
              meta: null,
              images: [],
            },
          },
        ],
      })
    ).toBe("visible text")

    expect(
      extractVisibleAssistantText(
        message("tool", [{ type: "text", text: "tool output" }])
      )
    ).toBe("")
    expect(extractVisibleAssistantText(null)).toBe("")
  })
})

describe("LiveTokenRateSampler", () => {
  function update(
    sampler: LiveTokenRateSampler,
    overrides: Partial<Parameters<LiveTokenRateSampler["update"]>[0]>
  ) {
    return sampler.update({
      active: true,
      runId: "run-1",
      visibleText: "",
      now: 0,
      ...overrides,
    })
  }

  it("uses provider samples over a 3 second window and throttles publishing for 500ms", () => {
    const sampler = new LiveTokenRateSampler()

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 0 },
        now: 0,
      })
    ).toEqual({ tokensPerSecond: null, source: "provider" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 10 },
        now: 1000,
      })
    ).toEqual({ tokensPerSecond: 10, source: "provider" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 20 },
        now: 1200,
      })
    ).toEqual({ tokensPerSecond: 10, source: "provider" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 30 },
        now: 1600,
      })
    ).toEqual({ tokensPerSecond: 19, source: "provider" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 80 },
        now: 5000,
      })
    ).toEqual({ tokensPerSecond: null, source: "provider" })
  })

  it("falls back to estimated visible text samples when provider data is missing or unusable", () => {
    const sampler = new LiveTokenRateSampler()

    expect(
      update(sampler, {
        visibleText: "abcd",
        now: 0,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: Number.NaN },
        visibleText: "abcd1234",
        now: 1000,
      })
    ).toEqual({ tokensPerSecond: 1, source: "estimated" })

    expect(
      update(sampler, {
        providerSample: {
          runId: "run-1",
          outputTokens: Number.POSITIVE_INFINITY,
        },
        visibleText: "abcd1234wxyz",
        now: 2000,
      })
    ).toEqual({ tokensPerSecond: 1, source: "estimated" })

    expect(
      update(sampler, {
        providerSample: { runId: "other-run", outputTokens: 100 },
        visibleText: "abcd1234wxyz0000",
        now: 3000,
      })
    ).toEqual({ tokensPerSecond: 1, source: "estimated" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: -1 },
        visibleText: "abcd1234wxyz00000000",
        now: 4000,
      })
    ).toEqual({ tokensPerSecond: 1, source: "estimated" })
  })

  it("resets the sample window and published snapshot when switching sources in either direction", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, {
      providerSample: { runId: "run-1", outputTokens: 0 },
      now: 0,
    })
    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 10 },
        now: 1000,
      })
    ).toEqual({ tokensPerSecond: 10, source: "provider" })

    expect(
      update(sampler, {
        visibleText: "abcd1234",
        now: 1200,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        visibleText: "abcd1234wxyz",
        now: 1700,
      })
    ).toEqual({ tokensPerSecond: 2, source: "estimated" })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 30 },
        visibleText: "abcd1234wxyz0000",
        now: 1900,
      })
    ).toEqual({ tokensPerSecond: null, source: "provider" })
    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 36 },
        visibleText: "abcd1234wxyz00000000",
        now: 2400,
      })
    ).toEqual({ tokensPerSecond: 12, source: "provider" })
  })

  it("publishes zero for active windows with no token growth", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, { visibleText: "abcd", now: 0 })

    expect(update(sampler, { visibleText: "abcd", now: 1000 })).toEqual({
      tokensPerSecond: 0,
      source: "estimated",
    })
  })

  it("resets on run changes, inactive input, text shrink, provider rollback, time rollback, and long gaps", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, {
      providerSample: { runId: "run-1", outputTokens: 0 },
      now: 0,
    })
    update(sampler, {
      providerSample: { runId: "run-1", outputTokens: 20 },
      now: 1000,
    })

    expect(
      update(sampler, {
        runId: "run-2",
        providerSample: { runId: "run-2", outputTokens: 1 },
        now: 1500,
      })
    ).toEqual({ tokensPerSecond: null, source: "provider" })
    expect(
      update(sampler, {
        active: false,
        runId: "run-2",
        providerSample: { runId: "run-2", outputTokens: 2 },
        now: 2000,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        runId: "run-2",
        providerSample: { runId: "run-2", outputTokens: 3 },
        now: 2500,
      })
    ).toEqual({ tokensPerSecond: null, source: "provider" })
    expect(
      update(sampler, {
        runId: "run-2",
        providerSample: { runId: "run-2", outputTokens: 2 },
        visibleText: "abcd1234",
        now: 3000,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        runId: "run-2",
        visibleText: "abcd1234wxyz",
        now: 3500,
      })
    ).toEqual({ tokensPerSecond: 2, source: "estimated" })
    expect(
      update(sampler, { runId: "run-2", visibleText: "abcd", now: 4000 })
    ).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })
    expect(
      update(sampler, { runId: "run-2", visibleText: "abcd1234", now: 3900 })
    ).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })
    expect(
      update(sampler, {
        runId: "run-2",
        visibleText: "abcd1234wxyz",
        now: 12_000,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
  })

  it("resets when visible text shrinks even if estimated tokens stay the same", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, { visibleText: "abcd", now: 0 })
    expect(update(sampler, { visibleText: "abcdefgh", now: 1000 })).toEqual({
      tokensPerSecond: 1,
      source: "estimated",
    })

    expect(update(sampler, { visibleText: "abc", now: 1500 })).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })
  })

  it("resets when estimated tokens shrink even if visible text length stays the same", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, { visibleText: "你好ab", now: 0 })
    expect(update(sampler, { visibleText: "你好ab", now: 1000 })).toEqual({
      tokensPerSecond: 0,
      source: "estimated",
    })

    expect(update(sampler, { visibleText: "abcd", now: 1500 })).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })
  })

  it("rejects non-finite timestamps without publishing invalid rates", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, { visibleText: "abcd", now: 0 })

    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 10 },
        now: Number.NaN,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 10 },
        now: Number.POSITIVE_INFINITY,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
    expect(
      update(sampler, {
        providerSample: { runId: "run-1", outputTokens: 10 },
        now: Number.NEGATIVE_INFINITY,
      })
    ).toEqual({ tokensPerSecond: null, source: "estimated" })
  })

  it("clears all state when reset is called", () => {
    const sampler = new LiveTokenRateSampler()

    update(sampler, { visibleText: "abcd", now: 0 })
    update(sampler, { visibleText: "abcd1234", now: 1000 })
    sampler.reset()

    expect(update(sampler, { visibleText: "abcd1234wxyz", now: 1500 })).toEqual(
      { tokensPerSecond: null, source: "estimated" }
    )
  })
})

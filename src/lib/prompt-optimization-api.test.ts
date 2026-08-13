const { callMock, transportMock } = vi.hoisted(() => {
  const callMock = vi.fn()
  return {
    callMock,
    transportMock: {
      call: callMock,
      subscribe: vi.fn(),
      isDesktop: vi.fn(() => false),
    },
  }
})

vi.mock("@/lib/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transport")>()
  return {
    ...actual,
    getTransport: () => transportMock,
  }
})

import { optimizePrompt } from "@/lib/api"

const PARAMS = {
  workingDir: "C:/repo",
  draft: "修复登录",
  conversationHistory: [],
  relatedFiles: [],
}

beforeEach(() => {
  callMock.mockReset()
})

it("uses a request id and transport deadline longer than the backend deadline", async () => {
  callMock.mockResolvedValueOnce("优化后的提示词")

  await expect(optimizePrompt(PARAMS)).resolves.toBe("优化后的提示词")

  expect(callMock).toHaveBeenCalledWith(
    "optimize_prompt",
    expect.objectContaining({
      ...PARAMS,
      requestId: expect.any(String),
    }),
    { timeoutMs: 125_000 }
  )
  expect(callMock.mock.calls[0]?.[1]).not.toHaveProperty("agentType")
})

it("asks the backend to cancel the matching optimization request", async () => {
  let requestId = ""
  callMock.mockImplementation((command, args) => {
    if (command === "optimize_prompt") {
      requestId = args.requestId
      return new Promise<string>(() => {})
    }
    return Promise.resolve(true)
  })
  const controller = new AbortController()

  void optimizePrompt(PARAMS, controller.signal)
  controller.abort()
  await vi.waitFor(() => {
    expect(callMock).toHaveBeenCalledWith("cancel_prompt_optimization", {
      requestId,
    })
  })
})

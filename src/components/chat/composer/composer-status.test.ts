import {
  findActiveToolCall,
  formatComposerElapsed,
  resolveComposerStatus,
  resolveWaitingReason,
} from "@/components/chat/composer/composer-status"

describe("resolveComposerStatus", () => {
  const idleInput = {
    waitingReason: null,
    isPrompting: false,
    activeToolTitle: null,
    hasError: false,
    wasStopped: false,
    isFocused: false,
    isNewConversation: false,
    isEmpty: true,
  } as const

  it("gives waiting-for-user precedence over every other state", () => {
    expect(
      resolveComposerStatus({
        ...idleInput,
        waitingReason: "permission",
        isPrompting: true,
        activeToolTitle: "Run command",
        hasError: true,
        wasStopped: true,
        isFocused: true,
        isNewConversation: true,
      })
    ).toBe("waiting_for_user")
  })

  it("distinguishes an active tool from ordinary generation", () => {
    expect(
      resolveComposerStatus({
        ...idleInput,
        isPrompting: true,
        activeToolTitle: "Read files",
      })
    ).toBe("tool_running")
    expect(resolveComposerStatus({ ...idleInput, isPrompting: true })).toBe(
      "generating"
    )
  })

  it("keeps running, result, focus, and new-conversation states ordered", () => {
    expect(
      resolveComposerStatus({
        ...idleInput,
        isPrompting: true,
        hasError: true,
        wasStopped: true,
      })
    ).toBe("generating")
    expect(
      resolveComposerStatus({
        ...idleInput,
        hasError: true,
        wasStopped: true,
        isFocused: true,
      })
    ).toBe("failed")
    expect(
      resolveComposerStatus({
        ...idleInput,
        wasStopped: true,
        isFocused: true,
      })
    ).toBe("stopped")
    expect(
      resolveComposerStatus({
        ...idleInput,
        isFocused: true,
        isNewConversation: true,
      })
    ).toBe("focused")
    expect(
      resolveComposerStatus({
        ...idleInput,
        isNewConversation: true,
      })
    ).toBe("new_empty")
    expect(
      resolveComposerStatus({
        ...idleInput,
        isNewConversation: true,
        isEmpty: false,
      })
    ).toBe("idle")
  })
})

describe("findActiveToolCall", () => {
  it("returns the latest unsettled tool and ignores completed or failed tools", () => {
    expect(
      findActiveToolCall([
        {
          type: "tool_call",
          info: { title: "First", status: "in_progress" },
        },
        { type: "text", text: "working" },
        {
          type: "tool_call",
          info: { title: "Done", status: "completed" },
        },
        {
          type: "tool_call",
          info: { title: "Latest", status: "pending" },
        },
        {
          type: "tool_call",
          info: { title: "Failed", status: "failed" },
        },
      ])
    ).toEqual({ title: "Latest" })
  })

  it("returns null when every tool call is settled", () => {
    expect(
      findActiveToolCall([
        {
          type: "tool_call",
          info: { title: "Done", status: "completed" },
        },
        {
          type: "tool_call",
          info: { title: "Stopped", status: "cancelled" },
        },
      ])
    ).toBeNull()
  })
})

describe("resolveWaitingReason", () => {
  it("uses a stable priority when several interaction slots are present", () => {
    expect(
      resolveWaitingReason({
        hasPermission: true,
        hasQuestion: true,
        hasAskQuestion: true,
        hasPlanApproval: true,
      })
    ).toBe("permission")
    expect(
      resolveWaitingReason({
        hasPermission: false,
        hasQuestion: true,
        hasAskQuestion: true,
        hasPlanApproval: true,
      })
    ).toBe("question")
    expect(
      resolveWaitingReason({
        hasPermission: false,
        hasQuestion: false,
        hasAskQuestion: true,
        hasPlanApproval: true,
      })
    ).toBe("question")
    expect(
      resolveWaitingReason({
        hasPermission: false,
        hasQuestion: false,
        hasAskQuestion: false,
        hasPlanApproval: true,
      })
    ).toBe("plan_approval")
  })
})

describe("formatComposerElapsed", () => {
  it("formats sub-second, second, and minute durations without invalid output", () => {
    expect(formatComposerElapsed(0)).toBe("0.0s")
    expect(formatComposerElapsed(450)).toBe("0.5s")
    expect(formatComposerElapsed(12_340)).toBe("12.3s")
    expect(formatComposerElapsed(65_400)).toBe("1:05")
    expect(formatComposerElapsed(-100)).toBe("0.0s")
    expect(formatComposerElapsed(Number.NaN)).toBe("0.0s")
  })
})

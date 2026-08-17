import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("@/components/chat/chat-input", () => ({
  ChatInput: (props: {
    status?: string | null
    waitingReason?: string | null
  }) => (
    <output
      data-testid="composer-state"
      data-status={props.status ?? "none"}
      data-waiting-reason={props.waitingReason ?? "none"}
    >
      {props.waitingReason ?? "none"}
    </output>
  ),
}))

vi.mock("@/components/chat/permission-dialog", () => ({
  PermissionDialog: () => null,
}))

vi.mock("@/components/chat/question-dialog", () => ({
  QuestionDialog: () => null,
}))

vi.mock("@/components/chat/ask-question-card", () => ({
  AskQuestionCard: () => null,
}))

vi.mock("@/components/chat/plan-approval-card", () => ({
  PlanApprovalCard: () => null,
}))

import { ConversationShell } from "./conversation-shell"

function renderShell(
  overrides: Partial<React.ComponentProps<typeof ConversationShell>> = {}
) {
  return render(
    <ConversationShell
      status="prompting"
      promptCapabilities={{
        image: false,
        audio: false,
        embedded_context: false,
      }}
      error={null}
      claudeApiRetry={null}
      pendingPermission={null}
      pendingQuestion={null}
      pendingAskQuestion={null}
      pendingPlanApproval={null}
      onFocus={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
      onRespondPermission={() => {}}
      onAnswerQuestion={() => {}}
      onAnswerAskQuestion={() => {}}
      onAnswerPlanApproval={() => {}}
      {...overrides}
    >
      <div>messages</div>
    </ConversationShell>
  )
}

describe("ConversationShell composer state", () => {
  it("keeps the composer layout empty when no relay exists", () => {
    const { container } = renderShell({ relaySlot: null })
    expect(container.querySelector("[data-relay-slot]")).toBeNull()
  })

  it.each([
    ["permission", { pendingPermission: {} as never }],
    ["question", { pendingQuestion: {} as never }],
    [
      "question",
      {
        pendingAskQuestion: {
          question_id: "question-1",
          questions: [],
        } as never,
      },
    ],
    ["plan_approval", { pendingPlanApproval: {} as never }],
  ])(
    "passes %s pending interactions as a waiting reason over generation",
    (expected, pendingState) => {
      renderShell(pendingState)

      const composer = screen.getByTestId("composer-state")
      expect(composer).toHaveAttribute("data-status", "prompting")
      expect(composer).toHaveAttribute("data-waiting-reason", expected)
    }
  )

  it("prefers permission when several pending slots coexist during generation", () => {
    renderShell({
      pendingPermission: {} as never,
      pendingQuestion: {} as never,
      pendingAskQuestion: {
        question_id: "question-1",
        questions: [],
      } as never,
      pendingPlanApproval: {} as never,
    })

    const composer = screen.getByTestId("composer-state")
    expect(composer).toHaveAttribute("data-status", "prompting")
    expect(composer).toHaveAttribute("data-waiting-reason", "permission")
  })
})

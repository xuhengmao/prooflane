import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// The composer body itself is irrelevant here — these tests are about which
// events the wrapper lets escape to the conversation panel around it.
vi.mock("@/components/chat/message-input", () => ({
  MessageInput: (props: {
    promptStartedAt?: number | null
    activeToolTitle?: string | null
    waitingReason?: string | null
    hasError?: boolean
    errorMessage?: string | null
    onRetry?: (() => void) | undefined
    isNewConversation?: boolean
    placeholder?: string
  }) => (
    <button
      type="button"
      data-testid="agent-icon"
      data-composer-state={JSON.stringify({
        promptStartedAt: props.promptStartedAt,
        activeToolTitle: props.activeToolTitle,
        waitingReason: props.waitingReason,
        hasError: props.hasError,
        errorMessage: props.errorMessage,
        hasRetry: typeof props.onRetry === "function",
        isNewConversation: props.isNewConversation,
        placeholder: props.placeholder,
      })}
    >
      agent
    </button>
  ),
}))

vi.mock("@/components/chat/message-queue-display", () => ({
  MessageQueueDisplay: () => null,
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

import { ChatInput } from "./chat-input"

/**
 * jsdom's `fireEvent.pointerDown` drops `pointerType` (it builds a plain
 * MouseEvent), so the property is pinned by hand — the guard under test reads
 * exactly that field.
 */
function pointerDown(element: Element, pointerType: string) {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  fireEvent(element, event)
}

function renderComposer(onPointerDown: () => void, onContextMenu: () => void) {
  // Stands in for the conversation panel's context-menu trigger, which wraps
  // the transcript AND the composer (conversations/conversation-detail-panel).
  return render(
    <div onPointerDown={onPointerDown} onContextMenu={onContextMenu}>
      <ChatInput
        status="connected"
        promptCapabilities={{
          image: false,
          audio: false,
          embedded_context: false,
        }}
        onSend={() => {}}
        onCancel={() => {}}
      />
    </div>
  )
}

describe("ChatInput event containment", () => {
  it("keeps a touch press from arming the conversation panel's long-press menu", () => {
    const onPointerDown = vi.fn()
    const onContextMenu = vi.fn()
    renderComposer(onPointerDown, onContextMenu)

    // A tap on a composer control (e.g. the agent icon) that lingers would
    // otherwise open the conversation context menu on touch devices.
    pointerDown(screen.getByTestId("agent-icon"), "touch")
    expect(onPointerDown).not.toHaveBeenCalled()
  })

  it("lets a mouse press through (the panel's selection bookkeeping needs it)", () => {
    const onPointerDown = vi.fn()
    const onContextMenu = vi.fn()
    renderComposer(onPointerDown, onContextMenu)

    pointerDown(screen.getByTestId("agent-icon"), "mouse")
    expect(onPointerDown).toHaveBeenCalled()
  })

  it("keeps a right-click inside the composer out of the conversation menu", () => {
    const onPointerDown = vi.fn()
    const onContextMenu = vi.fn()
    renderComposer(onPointerDown, onContextMenu)

    fireEvent.contextMenu(screen.getByTestId("agent-icon"))
    expect(onContextMenu).not.toHaveBeenCalled()
  })
})

describe("ChatInput composer state", () => {
  it("forwards structured composer state to MessageInput without changing queue behavior", () => {
    const onRetry = vi.fn()
    render(
      <ChatInput
        status="prompting"
        promptCapabilities={{
          image: false,
          audio: false,
          embedded_context: false,
        }}
        onSend={() => {}}
        onCancel={() => {}}
        promptStartedAt={1_700_000_000_000}
        activeToolTitle="Inspect repository"
        waitingReason="question"
        hasError
        errorMessage="Connection lost"
        onRetry={onRetry}
        isNewConversation
      />
    )

    expect(
      JSON.parse(
        screen.getByTestId("agent-icon").getAttribute("data-composer-state") ??
          "{}"
      )
    ).toEqual({
      promptStartedAt: 1_700_000_000_000,
      activeToolTitle: "Inspect repository",
      waitingReason: "question",
      hasError: true,
      errorMessage: "Connection lost",
      hasRetry: true,
      isNewConversation: true,
      placeholder: "continueInputQueue",
    })
  })
})

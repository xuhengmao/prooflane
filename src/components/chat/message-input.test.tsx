import {
  render,
  screen,
  waitFor,
  within,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react"
import type { Editor } from "@tiptap/core"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { RichComposerHandle } from "./composer/rich-composer"
import { serializeDocToText } from "./composer/to-prompt-blocks"
import { emitAttachFileToSession } from "@/lib/session-attachment-events"

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    uploadAttachment: vi.fn(async (file: File) => ({
      path: `/uploads/${file.name}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || null,
    })),
  }
})

// MessageInput holds its RichComposer handle internally and does not forward a
// ref, so capture that handle through a partial mock that still renders the real
// composer. The "insertion position" tests below drive the very Tiptap editor
// the attach-to-chat event writes into — setting its content + caret — then
// assert where the badge lands.
const composerHandle = vi.hoisted(() => ({
  current: null as RichComposerHandle | null,
}))
vi.mock("./composer/rich-composer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./composer/rich-composer")>()
  const React = await import("react")
  const Captured = React.forwardRef<
    RichComposerHandle,
    ComponentProps<typeof actual.RichComposer>
  >((props, ref) => {
    const assign = (handle: RichComposerHandle | null) => {
      composerHandle.current = handle
      if (typeof ref === "function") ref(handle)
      else if (ref) ref.current = handle
    }
    return React.createElement(actual.RichComposer, { ...props, ref: assign })
  })
  Captured.displayName = "CapturedRichComposer"
  return { ...actual, RichComposer: Captured }
})

// Mock the data hooks / platform so MessageInput mounts without hitting the
// backend. The reference-search provider and slash sources are all empty: this
// is a wiring smoke test (does the RichComposer-based input mount and reflect
// empty/send state), not a data test.
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: { send_message: "enter", newline_in_message: "shift+enter" },
  }),
}))
vi.mock("@/hooks/use-agent-skills", () => ({ useAgentSkills: () => [] }))
vi.mock("@/hooks/use-built-in-experts", () => ({ useBuiltInExperts: () => [] }))
vi.mock("@/hooks/use-built-in-science", () => ({ useBuiltInScience: () => [] }))
vi.mock("@/hooks/use-enabled-skill-ids", () => ({
  useEnabledSkillIds: () => ({
    enabledIds: new Set(),
    ready: false,
    supported: true,
  }),
}))
vi.mock("@/components/chat/composer/use-reference-search", () => ({
  useReferenceSearch: () => async () => [],
}))
vi.mock("@/components/chat/conversation-context-bar", () => ({
  ConversationContextBar: ({
    extraContent,
  }: {
    extraContent?: React.ReactNode
  }) => <div data-testid="ctx-bar">{extraContent}</div>,
  // The composer imports these to render the below-input folder/branch row.
  // Keep it hidden here (visibility → false) so these tests exercise the bare
  // composer without pulling in the picker's tab-store/git dependencies.
  ConversationFolderBranchPicker: () => null,
  useConversationFolderBranchPickerVisible: () => false,
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  openFileDialog: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
  isDesktop: () => false,
  getTransport: () => ({ call: vi.fn() }),
  getShellTransport: () => ({ call: vi.fn() }),
}))
// Real classifier only recognizes actual backend NoActiveTurn payloads; the
// steering tests flip this per-case to drive the enqueue fallback.
vi.mock("@/lib/turn-busy", () => ({
  isNoActiveTurnRejection: vi.fn(() => false),
}))
// virtua renders 0 rows under jsdom — render children directly so the large
// (searchable + virtualized) model list is exercisable here too.
vi.mock("virtua", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    Virtualizer: forwardRef(function VirtualizerMock(
      props: { children?: React.ReactNode },
      ref: React.Ref<{ scrollToIndex: () => void }>
    ) {
      useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }))
      return <>{props.children}</>
    }),
  }
})

// ModelOptionList mounts virtua only after the OverlayScrollbars viewport is
// surfaced via `onViewportRef`; jsdom never initializes OS, so drive it here.
vi.mock("@/components/ui/scroll-area", async () => {
  const { useEffect } = await import("react")
  return {
    ScrollArea: ({
      children,
      onViewportRef,
    }: {
      children?: React.ReactNode
      onViewportRef?: (el: HTMLElement | null) => void
    }) => {
      useEffect(() => {
        onViewportRef?.(document.createElement("div"))
      }, [onViewportRef])
      return <>{children}</>
    },
  }
})

import enMessages from "@/i18n/messages/en.json"
import type {
  PromptCapabilitiesInfo,
  SessionConfigOptionInfo,
} from "@/lib/types"
import type { PromptOptimizationProvider } from "./composer/prompt-optimization"
import type {
  SpeechTranscriptionProvider,
  SpeechTranscriptionSessionOptions,
} from "./composer/speech-input-provider"

import { MessageInput } from "./message-input"

const CAPS: PromptCapabilitiesInfo = {
  image: true,
  audio: false,
  embedded_context: true,
}

function renderInput(
  props: Partial<React.ComponentProps<typeof MessageInput>>
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageInput onSend={vi.fn()} promptCapabilities={CAPS} {...props} />
    </NextIntlClientProvider>
  )
}

describe("MessageInput (RichComposer integration)", () => {
  it("accepts relay dragover and routes the drop without invoking file handling", async () => {
    const onRelayDrop = vi.fn()
    const { RELAY_DRAG_MIME } = await import("@/lib/conversation-relay")
    const { uploadAttachment } = await import("@/lib/api")
    vi.mocked(uploadAttachment).mockClear()
    const { container } = renderInput({ onRelayDrop })
    const composer =
      container.querySelector("[data-tree-drop-composer]") ??
      container.querySelector("[data-composer-state]")
    let payloadReadable = false
    const dataTransfer: {
      types: string[]
      getData: (type: string) => string
      dropEffect: string
      files: File[]
    } = {
      types: [RELAY_DRAG_MIME],
      getData: (type: string) =>
        payloadReadable && type === RELAY_DRAG_MIME
          ? JSON.stringify({ conversationId: 42, folderId: 1 })
          : "",
      dropEffect: "none",
      files: [],
    }
    const dragOverBubble = vi.fn()
    const parent = container.parentElement!
    parent.addEventListener("dragover", dragOverBubble)

    expect(fireEvent.dragOver(composer as Element, { dataTransfer })).toBe(
      false
    )
    expect(dragOverBubble).not.toHaveBeenCalled()
    parent.removeEventListener("dragover", dragOverBubble)
    payloadReadable = true
    dataTransfer.files = [
      new File(["ignored"], "ignored.txt", { type: "text/plain" }),
    ]
    fireEvent.drop(composer as Element, { dataTransfer })
    expect(onRelayDrop).toHaveBeenCalledWith(42)
    expect(uploadAttachment).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    toastMock.success.mockClear()
    toastMock.error.mockClear()
    toastMock.info.mockClear()
  })

  it("mounts and renders the rich-text composer surface", async () => {
    const { container } = renderInput({})
    await waitFor(
      () => expect(container.querySelector('[role="textbox"]')).not.toBeNull(),
      { timeout: 5000 }
    )
    const textbox = container.querySelector('[role="textbox"]')
    expect(textbox).toHaveAttribute("aria-multiline", "true")
  })

  it("derives new-empty and focused states from the real editor", async () => {
    const { container } = renderInput({ isNewConversation: true })
    const textbox = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[role="textbox"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")

    expect(chrome).toHaveAttribute("data-composer-state", "new_empty")
    expect(screen.queryByTestId("composer-runtime-bar")).toBeNull()
    expect(chrome?.firstElementChild).toHaveAttribute("data-testid", "ctx-bar")
    fireEvent.focus(textbox)
    expect(chrome).toHaveAttribute("data-composer-state", "focused")
    fireEvent.blur(textbox)
    act(() => composerHandle.current?.setText("continue the task"))
    expect(chrome).toHaveAttribute("data-composer-state", "idle")
  })

  it("stays idle after text interaction is cleared and the editor loses focus", async () => {
    const { container } = renderInput({
      isNewConversation: true,
      conversationId: 101,
    })
    const textbox = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[role="textbox"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")

    act(() => composerHandle.current?.setText("draft"))
    expect(chrome).toHaveAttribute("data-composer-state", "idle")

    act(() => composerHandle.current?.setText(""))
    fireEvent.blur(textbox)

    expect(chrome).toHaveAttribute("data-composer-state", "idle")
  })

  it("stays idle after an image attachment is removed from an empty editor", async () => {
    const { container } = renderInput({
      isNewConversation: true,
      conversationId: 102,
    })
    const textbox = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[role="textbox"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")
    const image = new File(["image-bytes"], "proof.png", {
      type: "image/png",
    })
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
        getData: () => "",
      },
    })
    const removeButton = await screen.findByRole("button", {
      name: "Remove proof.png",
    })

    fireEvent.blur(textbox as HTMLElement)
    await waitFor(() =>
      expect(chrome).toHaveAttribute("data-composer-state", "idle")
    )
    await userEvent.click(removeButton)
    fireEvent.blur(textbox as HTMLElement)
    act(() => composerHandle.current?.getEditor()?.commands.blur())

    await waitFor(() => expect(removeButton).not.toBeInTheDocument())
    await waitFor(() =>
      expect(chrome).toHaveAttribute("data-composer-state", "idle")
    )
  })

  it("isolates interaction history by composer scope without leaking the previous frame", async () => {
    const committedStates: string[] = []

    function ScopeHarness() {
      const [conversationId, setConversationId] = useState(201)
      const hostRef = useRef<HTMLDivElement>(null)

      useLayoutEffect(() => {
        committedStates.push(
          hostRef.current?.querySelector<HTMLElement>("[data-composer-state]")
            ?.dataset.composerState ?? "missing"
        )
      }, [conversationId])

      return (
        <div>
          <button type="button" onClick={() => setConversationId(202)}>
            New scope
          </button>
          <button type="button" onClick={() => setConversationId(201)}>
            Old scope
          </button>
          <div ref={hostRef}>
            <MessageInput
              onSend={vi.fn()}
              promptCapabilities={CAPS}
              conversationId={conversationId}
              isNewConversation
            />
          </div>
        </div>
      )
    }

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ScopeHarness />
      </NextIntlClientProvider>
    )
    const textbox = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[role="textbox"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })

    act(() => composerHandle.current?.setText("draft"))
    fireEvent.blur(textbox)
    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "idle")

    fireEvent.click(screen.getByRole("button", { name: "New scope" }))
    expect(committedStates[committedStates.length - 1]).toBe("new_empty")

    act(() => composerHandle.current?.setText(""))
    fireEvent.blur(textbox)
    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "new_empty")

    fireEvent.click(screen.getByRole("button", { name: "Old scope" }))
    expect(committedStates[committedStates.length - 1]).toBe("idle")
  })

  it("shows runtime status inside the single composer frame", async () => {
    const startedAt = Date.now() - 1_250
    const { container, rerender } = renderInput({
      isPrompting: true,
      promptStartedAt: startedAt,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")
    expect(chrome).toHaveAttribute("data-composer-state", "generating")
    const runtimeBar = screen.getByTestId("composer-runtime-bar")
    expect(chrome).toContainElement(runtimeBar)
    expect(chrome?.firstElementChild).toBe(runtimeBar)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent(
      enMessages.Folder.chat.messageInput.statusGenerating
    )
    const elapsed = screen.getByTestId("composer-status-elapsed")
    expect(elapsed).toHaveTextContent(/^1\.[0-9]s$/)
    expect(status).not.toContainElement(elapsed)
    expect(status).toHaveTextContent(
      enMessages.Folder.chat.messageInput.statusGenerating
    )

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput
          onSend={vi.fn()}
          promptCapabilities={CAPS}
          isPrompting
          promptStartedAt={startedAt}
          activeToolTitle="Reading project files"
        />
      </NextIntlClientProvider>
    )

    expect(chrome).toHaveAttribute("data-composer-state", "tool_running")
    expect(screen.getByRole("status")).toHaveTextContent(
      enMessages.Folder.chat.messageInput.statusToolRunning.replace(
        "{tool}",
        "Reading project files"
      )
    )
  })

  it("gives waiting for user precedence and removes the flowing status", async () => {
    const { container } = renderInput({
      isPrompting: true,
      activeToolTitle: "Apply changes",
      waitingReason: "permission",
      promptStartedAt: Date.now() - 2_000,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")
    expect(chrome).toHaveAttribute("data-composer-state", "waiting_for_user")
    expect(screen.getByRole("status")).toHaveTextContent(
      enMessages.Folder.chat.messageInput.statusWaitingPermission
    )
    expect(screen.queryByTestId("composer-status-elapsed")).toBeNull()
  })

  it("clears the elapsed timer immediately when generation starts waiting for the user", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval")
    const clearIntervalSpy = vi.spyOn(window, "clearInterval")
    const startedAt = Date.now() - 1_000
    const { container, rerender } = renderInput({
      isPrompting: true,
      promptStartedAt: startedAt,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )
    const timerCall = setIntervalSpy.mock.calls.find(
      ([, delay]) => delay === 100
    )
    const timerIndex = timerCall
      ? setIntervalSpy.mock.calls.indexOf(timerCall)
      : -1
    expect(timerIndex).toBeGreaterThanOrEqual(0)
    const timerId = setIntervalSpy.mock.results[timerIndex]?.value

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput
          onSend={vi.fn()}
          promptCapabilities={CAPS}
          isPrompting
          promptStartedAt={startedAt}
          waitingReason="permission"
        />
      </NextIntlClientProvider>
    )

    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "waiting_for_user")
    await waitFor(() => expect(clearIntervalSpy).toHaveBeenCalledWith(timerId))
    expect(screen.queryByTestId("composer-status-elapsed")).toBeNull()

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it("shows stopped briefly only after the user cancels an active turn", async () => {
    const onCancel = vi.fn()
    const { container, rerender } = renderInput({
      isPrompting: true,
      onCancel,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    await userEvent.click(
      screen.getByTitle(enMessages.Folder.chat.messageInput.cancel)
    )
    expect(onCancel).toHaveBeenCalledOnce()

    vi.useFakeTimers()
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput onSend={vi.fn()} promptCapabilities={CAPS} />
      </NextIntlClientProvider>
    )

    const chrome = container.querySelector<HTMLElement>("[data-composer-state]")
    expect(chrome).toHaveAttribute("data-composer-state", "stopped")
    expect(screen.getByRole("status")).toHaveTextContent(
      enMessages.Folder.chat.messageInput.statusStopped
    )

    act(() => vi.advanceTimersByTime(1_500))
    expect(chrome).toHaveAttribute("data-composer-state", "idle")
    expect(screen.queryByRole("status")).toBeNull()
    vi.useRealTimers()
  })

  it("does not expose the previous stop feedback on the first frame of a new conversation", async () => {
    const committedStates: string[] = []

    function ScopeHarness() {
      const [isPrompting, setIsPrompting] = useState(true)
      const [conversationId, setConversationId] = useState(1)
      const hostRef = useRef<HTMLDivElement>(null)

      useLayoutEffect(() => {
        if (conversationId !== 2) return
        const chrome = hostRef.current?.querySelector<HTMLElement>(
          "[data-composer-state]"
        )
        committedStates.push(chrome?.dataset.composerState ?? "missing")
      }, [conversationId])

      return (
        <div>
          <button type="button" onClick={() => setIsPrompting(false)}>
            Finish old turn
          </button>
          <button type="button" onClick={() => setConversationId(2)}>
            Switch conversation
          </button>
          <div ref={hostRef}>
            <MessageInput
              onSend={vi.fn()}
              onCancel={vi.fn()}
              promptCapabilities={CAPS}
              isPrompting={isPrompting}
              conversationId={conversationId}
            />
          </div>
        </div>
      )
    }

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ScopeHarness />
      </NextIntlClientProvider>
    )
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    fireEvent.click(
      screen.getByTitle(enMessages.Folder.chat.messageInput.cancel)
    )
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "Finish old turn" }))
    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "stopped")

    fireEvent.click(screen.getByRole("button", { name: "Switch conversation" }))

    expect(committedStates).toEqual(["idle"])
    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "idle")

    act(() => vi.advanceTimersByTime(1_500))
    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "idle")
  })

  it("does not show stopped after an ordinary completed turn", async () => {
    const { container, rerender } = renderInput({ isPrompting: true })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput onSend={vi.fn()} promptCapabilities={CAPS} />
      </NextIntlClientProvider>
    )

    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "idle")
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("keeps a failed state visible and exposes the existing retry action", async () => {
    const onRetry = vi.fn()
    const { container } = renderInput({
      hasError: true,
      errorMessage: "Connection lost",
      onRetry,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    expect(
      container.querySelector<HTMLElement>("[data-composer-state]")
    ).toHaveAttribute("data-composer-state", "failed")
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost")
    await userEvent.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.retryStatus,
      })
    )
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("disables Send while the composer is empty and has no attachments", async () => {
    const { container } = renderInput({})
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )
    const sendButton = container.querySelector<HTMLButtonElement>(
      `button[title="${enMessages.Folder.chat.messageInput.send}"]`
    )
    expect(sendButton).not.toBeNull()
    expect(sendButton).toBeDisabled()
  })

  it("renders prompt optimization and speech controls before the primary send action", async () => {
    const { container } = renderInput({})
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const optimize = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.optimizePrompt,
    })
    const speech = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.startSpeechInput,
    })
    const send = screen.getByTitle(enMessages.Folder.chat.messageInput.send)
    const smartActions = optimize.parentElement
    const actionBar = smartActions?.parentElement

    expect(optimize.compareDocumentPosition(speech)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(speech.compareDocumentPosition(send)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(optimize).toBeDisabled()
    expect(speech).toBeEnabled()
    expect(optimize).toHaveClass("h-6", "w-6")
    expect(speech).toHaveClass("h-6", "w-6")
    expect(optimize.parentElement).toHaveClass("gap-1.5", "translate-x-0.5")
    expect(smartActions).toContainElement(speech)
    expect(actionBar).toContainElement(send)
    expect(actionBar).toHaveClass("items-end", "gap-2")
    expect(optimize).toHaveClass(
      "hover:border-primary/40",
      "hover:bg-primary/10"
    )
    expect(speech).toHaveClass("hover:border-primary/40", "hover:bg-primary/10")
  })

  it("keeps prompt optimization disabled for a reference-only draft", async () => {
    renderInput({})
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => {
      composerHandle.current?.getEditor()?.commands.insertReference({
        id: "app.ts",
        refType: "file",
        uri: "file:///repo/app.ts",
        label: "app.ts",
        meta: null,
      })
    })

    expect(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    ).toBeDisabled()
    expect(
      screen.getByTitle(enMessages.Folder.chat.messageInput.send)
    ).toBeEnabled()
  })

  it("optimizes the current draft and can restore the original document", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async ({ text }) => text.replace("verbose", "concise")),
    }
    const user = userEvent.setup()
    const { container } = renderInput({ promptOptimizationProvider: provider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )

    act(() => composerHandle.current?.setText("verbose request"))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )

    await waitFor(() =>
      expect(composerHandle.current?.getText()).toBe("concise request")
    )
    const undo = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.undoPromptOptimization,
    })
    const speech = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.startSpeechInput,
    })
    expect(
      screen.queryByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    ).not.toBeInTheDocument()
    expect(undo).toHaveClass("h-6", "w-6")
    expect(undo).toHaveClass("hover:border-primary/40", "hover:bg-primary/10")
    expect(undo.parentElement).toContainElement(speech)
    expect(undo.compareDocumentPosition(speech)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )

    await user.click(undo)
    expect(composerHandle.current?.getText()).toBe("verbose request")
    expect(
      container.querySelector("[data-prompt-optimization-summary]")
    ).toBeNull()
  })

  it("keeps the one-step undo available after editing an optimized draft", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async ({ text }) => text.replace("verbose", "concise")),
    }
    const user = userEvent.setup()
    renderInput({ promptOptimizationProvider: provider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("verbose request"))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )
    await waitFor(() =>
      expect(composerHandle.current?.getText()).toBe("concise request")
    )

    act(() => composerHandle.current?.setText("concise request with detail"))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.undoPromptOptimization,
      })
    )

    expect(composerHandle.current?.getText()).toBe("verbose request")
  })

  it("does not overwrite edits made while prompt optimization is pending", async () => {
    let resolveOptimization: ((value: string) => void) | null = null
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveOptimization = resolve
          })
      ),
    }
    const user = userEvent.setup()
    renderInput({ promptOptimizationProvider: provider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("original request"))

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )
    const optimizeButton = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.optimizePrompt,
    })
    expect(optimizeButton).toBeDisabled()
    expect(optimizeButton).toHaveAttribute("aria-busy", "true")
    expect(optimizeButton.querySelector("svg")).toHaveClass("animate-spin")
    act(() => composerHandle.current?.setText("user edited request"))
    await act(async () => {
      resolveOptimization?.("late optimized request")
    })

    expect(composerHandle.current?.getText()).toBe("user edited request")
    expect(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    ).toBeEnabled()
  })

  it("does not report a stale provider error after the draft changes", async () => {
    let rejectOptimization: ((reason: Error) => void) | null = null
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectOptimization = reject
          })
      ),
    }
    const user = userEvent.setup()
    renderInput({ promptOptimizationProvider: provider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("original request"))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )

    act(() => composerHandle.current?.setText("user edited request"))
    await act(async () => {
      rejectOptimization?.(new Error("late provider failure"))
    })

    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it("restores the optimization button after the provider fails", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async () => {
        throw new Error("provider unavailable")
      }),
    }
    const user = userEvent.setup()
    const { container } = renderInput({
      promptOptimizationProvider: provider,
    })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("original request"))

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledOnce())
    const optimizeButton = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.optimizePrompt,
    })
    expect(optimizeButton).toBeEnabled()
    expect(optimizeButton).toHaveAttribute("aria-busy", "false")
    expect(optimizeButton.querySelector("svg")).toBeNull()
    expect(container.querySelector(".prooflane-composer-optimizing")).toBeNull()
  })

  it("does not apply a pending optimization after the session changes", async () => {
    let resolveOptimization: ((value: string) => void) | null = null
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveOptimization = resolve
          })
      ),
    }
    const user = userEvent.setup()
    const rendered = renderInput({
      attachmentTabId: "session-a",
      promptOptimizationProvider: provider,
    })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("session A request"))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )

    rendered.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput
          onSend={vi.fn()}
          promptCapabilities={CAPS}
          attachmentTabId="session-b"
          promptOptimizationProvider={provider}
        />
      </NextIntlClientProvider>
    )
    act(() => composerHandle.current?.setText("session B request"))
    await act(async () => {
      resolveOptimization?.("late session A optimization")
    })

    expect(composerHandle.current?.getText()).toBe("session B request")
  })

  it("passes workspace, history, and related files to prompt optimization", async () => {
    const provider: PromptOptimizationProvider = {
      optimize: vi.fn(async ({ text }) => text),
    }
    const user = userEvent.setup()
    renderInput({
      agentType: "codex",
      defaultPath: "C:/repo",
      promptOptimizationContext: {
        conversationHistory: [
          { role: "user", text: "previous question" },
          { role: "assistant", text: "previous answer" },
        ],
        relatedFiles: ["src/auth.ts"],
      },
      promptOptimizationProvider: provider,
    })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("improve login"))

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.optimizePrompt,
      })
    )

    expect(provider.optimize).toHaveBeenCalledWith(
      {
        text: "{{PROOFLANE_SEGMENT_0_START}}\nimprove login\n{{PROOFLANE_SEGMENT_0_END}}",
        context: {
          workspacePath: "C:/repo",
          conversationHistory: [
            { role: "user", text: "previous question" },
            { role: "assistant", text: "previous answer" },
          ],
          relatedFiles: ["src/auth.ts"],
        },
      },
      expect.any(AbortSignal)
    )
  })

  it("inserts confirmed speech at the caret without sending the draft", async () => {
    let session: SpeechTranscriptionSessionOptions | null = null
    const speechProvider: SpeechTranscriptionProvider = {
      start: vi.fn((options) => {
        session = options
        options.onStart?.()
      }),
      stop: vi.fn(() => session?.onEnd()),
      abort: vi.fn(),
    }
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    }))
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    })
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderInput({ onSend, speechTranscriptionProvider: speechProvider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )

    act(() => composerHandle.current?.setText("Before "))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    )
    act(() => {
      session?.onTranscript([{ index: 0, text: "spoken text", isFinal: true }])
    })

    await waitFor(() =>
      expect(composerHandle.current?.getText()).toContain("spoken text")
    )
    expect(onSend).not.toHaveBeenCalled()
  })

  it("does not start recognition when voice input is stopped during permission request", async () => {
    let resolveStream: ((stream: MediaStream) => void) | null = null
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve
        })
    )
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    })
    const speechProvider: SpeechTranscriptionProvider = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    }
    const user = userEvent.setup()
    renderInput({ speechTranscriptionProvider: speechProvider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    )
    const permissionHint = screen.getByRole("status", {
      name: enMessages.Folder.chat.messageInput.speechPermissionRequest,
    })
    const speechButton = screen.getByRole("button", {
      name: enMessages.Folder.chat.messageInput.stopSpeechInput,
    })
    expect(permissionHint).toHaveClass("bottom-full")
    expect(speechButton.parentElement).toContainElement(permissionHint)
    expect(speechButton).toHaveClass("h-6", "w-6")
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.stopSpeechInput,
      })
    )
    expect(
      screen.queryByRole("status", {
        name: enMessages.Folder.chat.messageInput.speechPermissionRequest,
      })
    ).not.toBeInTheDocument()
    act(() =>
      resolveStream?.({
        getTracks: () => [track],
      } as unknown as MediaStream)
    )

    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce())
    expect(speechProvider.start).not.toHaveBeenCalled()
  })

  it("does not start recognition after a draft is sent during permission request", async () => {
    let resolveStream: ((stream: MediaStream) => void) | null = null
    const track = { stop: vi.fn() }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveStream = resolve
            })
        ),
      },
    })
    const speechProvider: SpeechTranscriptionProvider = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    }
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderInput({ onSend, speechTranscriptionProvider: speechProvider })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    act(() => composerHandle.current?.setText("send now"))

    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    )
    await user.click(
      screen.getByTitle(enMessages.Folder.chat.messageInput.send)
    )
    act(() =>
      resolveStream?.({
        getTracks: () => [track],
      } as unknown as MediaStream)
    )

    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce())
    expect(onSend).toHaveBeenCalledOnce()
    expect(speechProvider.start).not.toHaveBeenCalled()
  })

  it("releases active speech resources when the session changes", async () => {
    const track = { stop: vi.fn() }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [track],
        })),
      },
    })
    const speechProvider: SpeechTranscriptionProvider = {
      start: vi.fn((options) => options.onStart?.()),
      stop: vi.fn(),
      abort: vi.fn(),
    }
    const user = userEvent.setup()
    const rendered = renderInput({
      attachmentTabId: "session-a",
      speechTranscriptionProvider: speechProvider,
    })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    )

    rendered.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput
          onSend={vi.fn()}
          promptCapabilities={CAPS}
          attachmentTabId="session-b"
          speechTranscriptionProvider={speechProvider}
        />
      </NextIntlClientProvider>
    )

    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce())
    expect(speechProvider.abort).toHaveBeenCalled()
  })

  it("ignores late speech callbacks after the session changes", async () => {
    let sessionOptions: SpeechTranscriptionSessionOptions | null = null
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    })
    const speechProvider: SpeechTranscriptionProvider = {
      start: vi.fn((options) => {
        sessionOptions = options
        options.onStart?.()
      }),
      stop: vi.fn(),
      abort: vi.fn(),
    }
    const user = userEvent.setup()
    const rendered = renderInput({
      attachmentTabId: "session-a",
      speechTranscriptionProvider: speechProvider,
    })
    await waitFor(() =>
      expect(composerHandle.current?.getEditor()).toBeTruthy()
    )
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    )
    await waitFor(() => expect(sessionOptions).not.toBeNull())

    rendered.rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <MessageInput
          onSend={vi.fn()}
          promptCapabilities={CAPS}
          attachmentTabId="session-b"
          speechTranscriptionProvider={speechProvider}
        />
      </NextIntlClientProvider>
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: enMessages.Folder.chat.messageInput.startSpeechInput,
        })
      ).toBeEnabled()
    )
    act(() => {
      sessionOptions?.onTranscript([
        { index: 0, text: "old session text", isFinal: true },
      ])
      sessionOptions?.onError("network")
      sessionOptions?.onEnd()
    })

    expect(composerHandle.current?.getText()).toBe("")
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.messageInput.startSpeechInput,
      })
    ).toBeEnabled()
  })

  it("claims a mousedown on the input's empty chrome (P8d focus wiring)", async () => {
    const { container } = renderInput({})
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )
    // The bordered card carries the chrome-focus handler; a mousedown on the
    // card itself (not on the editor or a control) is claimed via preventDefault
    // before refocusing the editor. Asserting preventDefault (fireEvent returns
    // false when the event was canceled) avoids relying on jsdom focus.
    const card = container.querySelector('[class~="@container"]') as HTMLElement
    expect(card).not.toBeNull()
    // The same box paints the text I-beam across its blank chrome (see the
    // `.codeg-composer-chrome` rule in globals.css).
    expect(card.className).toContain("codeg-composer-chrome")
    expect(fireEvent.mouseDown(card)).toBe(false)
  })
})

describe("MessageInput attach-to-chat insertion position", () => {
  afterEach(() => {
    cleanup()
    composerHandle.current = null
  })

  async function mountWithEditor() {
    renderInput({ attachmentTabId: "tab-1" })
    await waitFor(
      () => expect(composerHandle.current?.getEditor()).toBeTruthy(),
      { timeout: 5000 }
    )
    const editor = composerHandle.current?.getEditor()
    if (!editor) throw new Error("composer editor not mounted")
    return editor
  }

  // Seed "hello world" and drop the caret right after "hello" (pos 6), so an
  // insertion at the caret lands between the two words while an append would
  // land after "world".
  function seedWithMidCaret(editor: Editor) {
    act(() => {
      editor.commands.setContent("hello world")
      editor.commands.setTextSelection(6)
    })
  }

  function assertBetweenHelloAndWorld(text: string, link: string) {
    const at = text.indexOf(link)
    expect(at).toBeGreaterThanOrEqual(0)
    // Caret insertion: "hello" precedes the badge and "world" follows it.
    // (An end-of-doc append would put "world" before the link, failing the
    // second assertion.)
    expect(text.slice(0, at)).toContain("hello")
    expect(text.slice(at + link.length)).toContain("world")
  }

  it("drops an attached whole-file badge at the caret, not the end", async () => {
    const editor = await mountWithEditor()
    seedWithMidCaret(editor)
    act(() => {
      emitAttachFileToSession({ tabId: "tab-1", path: "/repo/app.ts" })
    })
    const link = "[app.ts](file:///repo/app.ts)"
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).toContain(link)
    )
    assertBetweenHelloAndWorld(serializeDocToText(editor.state.doc), link)
  })

  it("drops a ranged selection badge at the caret, not the end", async () => {
    const editor = await mountWithEditor()
    seedWithMidCaret(editor)
    act(() => {
      emitAttachFileToSession({
        tabId: "tab-1",
        path: "/repo/app.ts",
        range: { start: 10, end: 25 },
      })
    })
    const link = "[app.ts:10-25](file:///repo/app.ts#L10-25)"
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).toContain(link)
    )
    assertBetweenHelloAndWorld(serializeDocToText(editor.state.doc), link)
  })
})

describe("MessageInput file-tree drag-and-drop", () => {
  afterEach(() => {
    cleanup()
    composerHandle.current = null
  })

  // A minimal DataTransfer carrying a file-tree drag: the private JSON payload
  // plus a text/plain absolute-path fallback (jsdom's DataTransfer can't do
  // setData/getData/types faithfully).
  function treeDrag(payload: {
    rootPath: string
    relPath: string
    absPath: string
    name: string
    kind: "file" | "dir"
  }) {
    const store = new Map<string, string>([
      ["application/x-codeg-tree-entry", JSON.stringify(payload)],
      ["text/plain", payload.absPath],
    ])
    return {
      getData: (f: string) => store.get(String(f).toLowerCase()) ?? "",
      setData: (f: string, v: string) => store.set(String(f).toLowerCase(), v),
      get types() {
        return Array.from(store.keys())
      },
      dropEffect: "none",
      effectAllowed: "all",
      files: [] as File[],
      items: [] as DataTransferItem[],
    }
  }

  async function mountWithHost() {
    const { container } = renderInput({ attachmentTabId: "tab-1" })
    await waitFor(
      () => expect(composerHandle.current?.getEditor()).toBeTruthy(),
      { timeout: 5000 }
    )
    const editor = composerHandle.current?.getEditor()
    if (!editor) throw new Error("composer editor not mounted")
    const host = container.firstElementChild as HTMLElement
    return { editor, host }
  }

  const OVERLAY = enMessages.Folder.chat.messageInput.dropFilesToAttach
  const PAYLOAD = {
    rootPath: "/repo",
    relPath: "src/app.ts",
    absPath: "/repo/src/app.ts",
    name: "app.ts",
    kind: "file" as const,
  }
  const LINK = "[app.ts](file:///repo/src/app.ts)"

  it("inserts a single reference (no literal path) when dropped on the chrome", async () => {
    const { editor, host } = await mountWithHost()
    const dt = treeDrag(PAYLOAD)

    act(() => {
      fireEvent.dragOver(host, { dataTransfer: dt })
    })
    // The drag overlay shows while a valid drag hovers the composer.
    expect(screen.queryByText(OVERLAY)).not.toBeNull()

    act(() => {
      fireEvent.drop(host, { dataTransfer: dt })
    })
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).toContain(LINK)
    )
    // Exactly one reference and no stray text/plain absolute-path insertion.
    expect(serializeDocToText(editor.state.doc).trim()).toBe(LINK)
    // The overlay is cleared by the drop.
    expect(screen.queryByText(OVERLAY)).toBeNull()
  })

  it("clears the overlay and inserts once when dropped on the editor surface", async () => {
    const { editor, host } = await mountWithHost()
    const textbox = host.querySelector('[role="textbox"]') as HTMLElement
    const dt = treeDrag(PAYLOAD)

    // Hover raises the overlay (container-level dragover)…
    act(() => {
      fireEvent.dragOver(host, { dataTransfer: dt })
    })
    expect(screen.queryByText(OVERLAY)).not.toBeNull()

    // …then drop directly on the editor. Whether ProseMirror's handleDrop
    // consumes it (stopping propagation) or it bubbles to the container, the
    // result must be one reference and no lingering overlay — the regression
    // being that an editor-consumed drop left the overlay stuck.
    act(() => {
      fireEvent.drop(textbox, { dataTransfer: dt })
    })
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).toContain(LINK)
    )
    expect(serializeDocToText(editor.state.doc).trim()).toBe(LINK)
    expect(screen.queryByText(OVERLAY)).toBeNull()
  })
})

// When the composer is narrow the model/config/mode selectors collapse behind a
// cog button into a single Popover that renders a master–detail panel: the
// settings on the left, the active setting's options (plain buttons) on the
// right. This is the WebKit-safe replacement for the old nested dropdown/submenu
// — a nested Radix dismissable layer drops the selection on WKWebView, so the
// options are plain <button>s in the one popover layer. jsdom has no layout, so
// the container-query-hidden wide row stays hidden and this collapsed path is
// what renders here.
const MODEL_OPTION: SessionConfigOptionInfo = {
  id: "model",
  name: "Model",
  description: "Pick the model",
  category: null,
  kind: {
    type: "select",
    current_value: "default",
    options: [
      { value: "default", name: "Default", description: "Use the default" },
      { value: "opus", name: "Opus", description: "Most capable" },
    ],
    groups: [],
  },
}

const MSGS = enMessages.Folder.chat.messageInput

// Cline 3.0.50's `auto_approve` — the first boolean config option any pinned
// agent ships. Both the wide inline row and the collapsed popover are always in
// the DOM (a container query, which jsdom does not evaluate, picks one), so a
// single render exercises both surfaces.
const AUTO_APPROVE_OPTION: SessionConfigOptionInfo = {
  id: "auto_approve",
  name: "Auto-approve tools",
  description: "Automatically approve all tool calls without asking",
  category: null,
  kind: { type: "boolean", current_value: false },
}

describe("MessageInput boolean config options", () => {
  afterEach(() => cleanup())

  it("renders the inline chip as a toggle and flips it on click", async () => {
    const user = userEvent.setup()
    const onConfigOptionChange = vi.fn()
    const { container } = renderInput({
      configOptions: [AUTO_APPROVE_OPTION],
      onConfigOptionChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const toggle = screen.getByRole("button", {
      name: `Auto-approve tools: ${MSGS.toggleOff}`,
    })
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    await user.click(toggle)
    expect(onConfigOptionChange).toHaveBeenCalledWith("auto_approve", "true")
  })

  it("offers On/Off rows in the collapsed cog popover", async () => {
    const user = userEvent.setup()
    const onConfigOptionChange = vi.fn()
    const { container } = renderInput({
      configOptions: [AUTO_APPROVE_OPTION],
      onConfigOptionChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const settingsLabel = MSGS.agentSettings
    await user.click(screen.getByRole("button", { name: settingsLabel }))
    const popover = await screen.findByRole("dialog", { name: settingsLabel })

    // The left rail summarizes the current state…
    expect(
      within(popover).getByRole("button", { name: /Auto-approve tools/ })
    ).toBeInTheDocument()
    // …and the detail pane is a plain two-item choice.
    await user.click(
      within(popover).getByRole("button", { name: MSGS.toggleOn })
    )
    expect(onConfigOptionChange).toHaveBeenCalledWith("auto_approve", "true")
  })
})

describe("MessageInput collapsed selectors popover", () => {
  afterEach(() => cleanup())

  it("selects a config option from the cog Popover and closes it", async () => {
    const user = userEvent.setup()
    const onConfigOptionChange = vi.fn()
    const { container } = renderInput({
      configOptions: [MODEL_OPTION],
      onConfigOptionChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const settingsLabel = enMessages.Folder.chat.messageInput.agentSettings
    await user.click(screen.getByRole("button", { name: settingsLabel }))

    const popover = await screen.findByRole("dialog", { name: settingsLabel })
    // The left rail shows the setting as a title + current value row.
    expect(
      within(popover).getByRole("button", { name: /Model/ })
    ).toBeInTheDocument()

    // Options are plain buttons (native clicks) — selecting fires the change.
    await user.click(within(popover).getByRole("button", { name: /Opus/ }))
    expect(onConfigOptionChange).toHaveBeenCalledWith("model", "opus")

    // Selecting a value closes the controlled popover.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: settingsLabel })).toBeNull()
    )
  })

  it("groups model values by their provider prefix in the cog Popover", async () => {
    const user = userEvent.setup()
    const onConfigOptionChange = vi.fn()
    const groupedModel: SessionConfigOptionInfo = {
      id: "model",
      name: "Model",
      description: "Pick the model",
      category: null,
      kind: {
        type: "select",
        current_value: "anthropic/claude-opus",
        options: [
          {
            value: "anthropic/claude-opus",
            name: "anthropic/claude-opus",
            description: null,
          },
          { value: "openai/gpt-4o", name: "openai/gpt-4o", description: null },
        ],
        groups: [],
      },
    }
    const { container } = renderInput({
      configOptions: [groupedModel],
      onConfigOptionChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const settingsLabel = enMessages.Folder.chat.messageInput.agentSettings
    await user.click(screen.getByRole("button", { name: settingsLabel }))
    const popover = await screen.findByRole("dialog", { name: settingsLabel })

    // The detail pane carries one header per provider namespace…
    expect(within(popover).getByText("anthropic")).toBeInTheDocument()
    expect(within(popover).getByText("openai")).toBeInTheDocument()

    // …and the option label drops the redundant `openai/` prefix, while the
    // committed value stays the full id. (Pick the non-current model so its
    // label is unique to the detail pane, not echoed in the left-rail summary.)
    await user.click(within(popover).getByRole("button", { name: /gpt-4o/ }))
    expect(onConfigOptionChange).toHaveBeenCalledWith("model", "openai/gpt-4o")
  })

  it("uses a searchable virtualized list for a long model list", async () => {
    const user = userEvent.setup()
    const onConfigOptionChange = vi.fn()
    const options = Array.from({ length: 30 }, (_, i) => ({
      value: `openrouter/model-${i}`,
      name: `openrouter/model-${i}`,
      description: null,
    }))
    const bigModel: SessionConfigOptionInfo = {
      id: "model",
      name: "Model",
      description: null,
      category: null,
      kind: {
        type: "select",
        current_value: "openrouter/model-0",
        options,
        groups: [],
      },
    }
    const { container } = renderInput({
      configOptions: [bigModel],
      onConfigOptionChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const settingsLabel = enMessages.Folder.chat.messageInput.agentSettings
    await user.click(screen.getByRole("button", { name: settingsLabel }))
    const popover = await screen.findByRole("dialog", { name: settingsLabel })

    // A long list (> threshold) renders the searchable combobox, not plain rows.
    const search = within(popover).getByRole("combobox")
    await user.type(search, "model-17")
    // Filtering narrows to the one match; the full id is committed on click.
    await user.click(within(popover).getByRole("option", { name: /model-17/ }))
    expect(onConfigOptionChange).toHaveBeenCalledWith(
      "model",
      "openrouter/model-17"
    )
  })

  it("selects a mode from the cog Popover and closes it", async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    const { container } = renderInput({
      modes: [
        { id: "plan", name: "Plan", description: "Plan first" },
        { id: "act", name: "Act", description: "Act now" },
      ],
      selectedModeId: "plan",
      onModeChange,
    })
    await waitFor(() =>
      expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    )

    const settingsLabel = enMessages.Folder.chat.messageInput.agentSettings
    await user.click(screen.getByRole("button", { name: settingsLabel }))

    const popover = await screen.findByRole("dialog", { name: settingsLabel })
    await user.click(within(popover).getByRole("button", { name: /Act/ }))
    expect(onModeChange).toHaveBeenCalledWith("act")

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: settingsLabel })).toBeNull()
    )
  })
})

describe("MessageInput native steering (insert into current turn)", () => {
  afterEach(() => {
    cleanup()
    composerHandle.current = null
    vi.clearAllMocks()
  })

  const MI = enMessages.Folder.chat.messageInput

  async function mountPrompting(
    props: Partial<React.ComponentProps<typeof MessageInput>> = {}
  ) {
    renderInput({
      isPrompting: true,
      disabled: true,
      onCancel: vi.fn(),
      onEnqueue: vi.fn(),
      ...props,
    })
    await waitFor(
      () => expect(composerHandle.current?.getEditor()).toBeTruthy(),
      { timeout: 5000 }
    )
    const editor = composerHandle.current?.getEditor()
    if (!editor) throw new Error("composer editor not mounted")
    return editor
  }

  function typeDraft(editor: Editor, text: string) {
    // insertContent dispatches a real transaction, so the composer's
    // empty-tracking flips (plain setContent doesn't emit an update).
    act(() => {
      editor.commands.insertContent(text)
    })
  }

  it("keeps the historical Stop-only form when onSteer is absent", async () => {
    const editor = await mountPrompting()
    typeDraft(editor, "draft text")
    // Stop is there; none of the split-button chrome is.
    expect(screen.getByTitle(MI.cancel)).toBeInTheDocument()
    expect(screen.queryByTitle(MI.queueMessage)).toBeNull()
    expect(screen.queryByLabelText(MI.steerIntoTurn)).toBeNull()
  })

  it("shows the queue/steer split next to Stop once there is content", async () => {
    const editor = await mountPrompting({ onSteer: vi.fn() })
    // Empty draft: nothing to queue or steer — still Stop-only.
    expect(screen.queryByTitle(MI.queueMessage)).toBeNull()

    typeDraft(editor, "go left")
    await waitFor(() =>
      expect(screen.getByTitle(MI.queueMessage)).toBeInTheDocument()
    )
    expect(screen.getByLabelText(MI.steerIntoTurn)).toBeInTheDocument()
    expect(screen.getByTitle(MI.cancel)).toBeInTheDocument()
  })

  it("steers the draft text and clears the composer on success", async () => {
    const user = userEvent.setup()
    let resolveSteer: () => void = () => {}
    const onSteer = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSteer = r
        })
    )
    const editor = await mountPrompting({ onSteer })
    typeDraft(editor, "go left")
    await waitFor(() =>
      expect(screen.getByLabelText(MI.steerIntoTurn)).toBeInTheDocument()
    )

    await user.click(screen.getByLabelText(MI.steerIntoTurn))
    await user.click(
      await screen.findByRole("menuitem", { name: MI.steerIntoTurn })
    )
    await waitFor(() => expect(onSteer).toHaveBeenCalledWith("go left"))
    // Unsettled: the draft must survive until the backend confirms.
    expect(serializeDocToText(editor.state.doc)).toContain("go left")

    await act(async () => {
      resolveSteer()
    })
    // Confirmed: the composer clears (the split collapses back to Stop-only).
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).not.toContain("go left")
    )
    await waitFor(() => expect(screen.queryByTitle(MI.queueMessage)).toBeNull())
  })

  it("falls back to the queue when the turn ends in the race window", async () => {
    const user = userEvent.setup()
    const { isNoActiveTurnRejection } = await import("@/lib/turn-busy")
    vi.mocked(isNoActiveTurnRejection).mockReturnValue(true)
    const onSteer = vi.fn().mockRejectedValue(new Error("no active turn"))
    const onEnqueue = vi.fn()
    const editor = await mountPrompting({ onSteer, onEnqueue })
    typeDraft(editor, "late note")
    await waitFor(() =>
      expect(screen.getByLabelText(MI.steerIntoTurn)).toBeInTheDocument()
    )

    await user.click(screen.getByLabelText(MI.steerIntoTurn))
    await user.click(
      await screen.findByRole("menuitem", { name: MI.steerIntoTurn })
    )

    await waitFor(() => expect(onEnqueue).toHaveBeenCalled())
    const [draft] = onEnqueue.mock.calls[0]
    expect(draft.blocks).toEqual([{ type: "text", text: "late note" }])
    // Draft consumed by the queue, not lost and not duplicated.
    await waitFor(() =>
      expect(serializeDocToText(editor.state.doc)).not.toContain("late note")
    )
  })

  it("keeps the draft on a non-turn-end failure", async () => {
    const user = userEvent.setup()
    const { isNoActiveTurnRejection } = await import("@/lib/turn-busy")
    vi.mocked(isNoActiveTurnRejection).mockReturnValue(false)
    const onSteer = vi.fn().mockRejectedValue(new Error("boom"))
    const onEnqueue = vi.fn()
    const editor = await mountPrompting({ onSteer, onEnqueue })
    typeDraft(editor, "keep me")
    await waitFor(() =>
      expect(screen.getByLabelText(MI.steerIntoTurn)).toBeInTheDocument()
    )

    await user.click(screen.getByLabelText(MI.steerIntoTurn))
    await user.click(
      await screen.findByRole("menuitem", { name: MI.steerIntoTurn })
    )

    await waitFor(() => expect(onSteer).toHaveBeenCalled())
    // Real failure: nothing queued, draft intact for retry.
    expect(onEnqueue).not.toHaveBeenCalled()
    expect(serializeDocToText(editor.state.doc)).toContain("keep me")
  })
})

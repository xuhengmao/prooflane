export type ComposerStatus =
  | "waiting_for_user"
  | "tool_running"
  | "generating"
  | "failed"
  | "stopped"
  | "focused"
  | "new_empty"
  | "idle"

export type ComposerWaitingReason = "permission" | "question" | "plan_approval"

export interface ComposerStatusInput {
  waitingReason: ComposerWaitingReason | null
  isPrompting: boolean
  activeToolTitle: string | null
  hasError: boolean
  wasStopped: boolean
  isFocused: boolean
  isNewConversation: boolean
  isEmpty: boolean
}

export function resolveComposerStatus({
  waitingReason,
  isPrompting,
  activeToolTitle,
  hasError,
  wasStopped,
  isFocused,
  isNewConversation,
  isEmpty,
}: ComposerStatusInput): ComposerStatus {
  if (waitingReason) return "waiting_for_user"
  if (isPrompting) return activeToolTitle ? "tool_running" : "generating"
  if (hasError) return "failed"
  if (wasStopped) return "stopped"
  if (isFocused) return "focused"
  if (isNewConversation && isEmpty) return "new_empty"
  return "idle"
}

interface ToolCallContent {
  type: string
  [key: string]: unknown
  info?: {
    title?: unknown
    status?: unknown
  }
}

const SETTLED_TOOL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "error",
])

export function findActiveToolCall(
  content: readonly ToolCallContent[] | null | undefined
): { title: string } | null {
  if (!content) return null

  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index]
    if (block.type !== "tool_call" || !block.info) continue

    const status =
      typeof block.info.status === "string"
        ? block.info.status.toLowerCase()
        : ""
    if (SETTLED_TOOL_STATUSES.has(status)) continue

    const title = block.info.title
    if (typeof title === "string" && title.trim()) {
      return { title: title.trim() }
    }
  }

  return null
}

export function resolveWaitingReason(input: {
  hasPermission: boolean
  hasQuestion: boolean
  hasAskQuestion: boolean
  hasPlanApproval: boolean
}): ComposerWaitingReason | null {
  if (input.hasPermission) return "permission"
  if (input.hasQuestion || input.hasAskQuestion) return "question"
  if (input.hasPlanApproval) return "plan_approval"
  return null
}

export function formatComposerElapsed(milliseconds: number): string {
  const safeMilliseconds =
    Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0
  const seconds = safeMilliseconds / 1000

  if (seconds < 60) return `${seconds.toFixed(1)}s`

  const wholeSeconds = Math.floor(seconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const remainingSeconds = wholeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

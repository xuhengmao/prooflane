"use client"

import type { JSX } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Bot, FilePenLine, RotateCcw, Timer, Wrench } from "lucide-react"

import { AgentIcon } from "@/components/agent-icon"
import type { ComposerStatus } from "@/components/chat/composer/composer-status"
import {
  countLiveToolCalls,
  extractLiveEditStats,
  resolveLiveTurnPhase,
  type LiveEditStats,
  type LiveTurnPhase,
} from "@/components/message/live-turn-stats"
import type { AgentType } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useConversationRuntimeStore } from "@/stores/conversation-runtime-store"

export type ComposerRuntimeStatus = Extract<
  ComposerStatus,
  "generating" | "tool_running" | "waiting_for_user" | "failed" | "stopped"
>

export function isComposerRuntimeStatus(
  status: ComposerStatus
): status is ComposerRuntimeStatus {
  return (
    status === "generating" ||
    status === "tool_running" ||
    status === "waiting_for_user" ||
    status === "failed" ||
    status === "stopped"
  )
}

export interface ComposerRuntimeBarProps {
  conversationId?: number | null
  agentType?: AgentType | null
  status: ComposerRuntimeStatus
  statusLabel: string
  elapsedLabel: string | null
  retryLabel: string
  onRetry?: () => void
}

export interface ComposerRuntimeBarContentProps extends Omit<
  ComposerRuntimeBarProps,
  "conversationId"
> {
  phase: LiveTurnPhase | null
  editStats: LiveEditStats
  toolCallCount: number
}

function formatCompactInt(value: number, formatter: Intl.NumberFormat): string {
  return value < 1000 ? String(value) : formatter.format(value)
}

export function ComposerRuntimeBarContent({
  agentType,
  status,
  statusLabel,
  elapsedLabel,
  retryLabel,
  onRetry,
  phase,
  editStats,
  toolCallCount,
}: ComposerRuntimeBarContentProps): JSX.Element {
  const locale = useLocale()
  const tLive = useTranslations("Folder.chat.liveTurnStats")
  const activeRun = status === "generating" || status === "tool_running"
  const compactFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const toolCallLabel =
    toolCallCount > 0 ? tLive("toolUseCount", { count: toolCallCount }) : null
  const editSummary = `${editStats.files}F +${formatCompactInt(
    editStats.additions,
    compactFormatter
  )}/-${formatCompactInt(editStats.deletions, compactFormatter)}`

  return (
    <div
      className="prooflane-composer-runtime-bar flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs text-muted-foreground"
      data-composer-runtime-state={status}
      data-testid="composer-runtime-bar"
    >
      <span
        className={cn(
          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center",
          activeRun && "animate-pulse motion-reduce:animate-none"
        )}
        data-testid="composer-runtime-agent"
      >
        {agentType ? (
          <AgentIcon agentType={agentType} className="h-3.5 w-3.5" />
        ) : (
          <Bot aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </span>

      {phase !== null && <span>{tLive(phase)}</span>}

      <span
        aria-atomic="true"
        aria-live="polite"
        className="inline-flex min-w-0 items-center gap-1.5 break-words"
        role="status"
      >
        <span
          aria-hidden="true"
          className="prooflane-composer-status-dot h-1.5 w-1.5 shrink-0 rounded-full"
        />
        <span title={statusLabel}>{statusLabel}</span>
      </span>

      {elapsedLabel !== null && (
        <span
          className="inline-flex items-center gap-1"
          data-testid="composer-status-elapsed"
        >
          <Timer aria-hidden="true" className="h-3 w-3 shrink-0" />
          {elapsedLabel}
        </span>
      )}

      {editStats.files > 0 && (
        <span className="inline-flex items-center gap-1">
          <FilePenLine aria-hidden="true" className="h-3 w-3 shrink-0" />
          {editSummary}
        </span>
      )}

      {toolCallLabel !== null && (
        <span className="inline-flex items-center gap-1">
          <Wrench aria-hidden="true" className="h-3 w-3 shrink-0" />
          {toolCallLabel}
        </span>
      )}

      {status === "failed" && onRetry && (
        <button
          aria-label={retryLabel}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}
          title={retryLabel}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function ComposerRuntimeBar({
  conversationId,
  ...props
}: ComposerRuntimeBarProps): JSX.Element {
  const liveMessage = useConversationRuntimeStore((store) =>
    conversationId == null
      ? null
      : (store.byConversationId.get(conversationId)?.liveMessage ?? null)
  )
  const activeRun =
    props.status === "generating" || props.status === "tool_running"
  const phase =
    activeRun && liveMessage
      ? resolveLiveTurnPhase(liveMessage, true)
      : activeRun
        ? "streaming"
        : null
  const editStats = liveMessage
    ? extractLiveEditStats(liveMessage)
    : { files: 0, additions: 0, deletions: 0 }
  const toolCallCount = liveMessage ? countLiveToolCalls(liveMessage) : 0

  return (
    <ComposerRuntimeBarContent
      {...props}
      editStats={editStats}
      phase={phase}
      toolCallCount={toolCallCount}
    />
  )
}

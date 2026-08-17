"use client"

import type { JSX } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Bot, FilePenLine, Gauge, RotateCcw, Timer, Wrench } from "lucide-react"

import { AgentIcon } from "@/components/agent-icon"
import type { ComposerStatus } from "@/components/chat/composer/composer-status"
import { useLiveTokenRate } from "@/components/chat/composer/use-live-token-rate"
import {
  countLiveToolCalls,
  extractLiveEditStats,
  resolveLiveTurnPhase,
  type LiveEditStats,
  type LiveTurnPhase,
} from "@/components/message/live-turn-stats"
import type { LiveTokenRateSnapshot } from "@/components/chat/composer/live-token-rate"
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
  tokenRate: LiveTokenRateSnapshot
}

function formatCompactInt(value: number, formatter: Intl.NumberFormat): string {
  return value < 1000 ? String(value) : formatter.format(value)
}

function formatTokenRate(snapshot: LiveTokenRateSnapshot): string {
  const { tokensPerSecond, source } = snapshot
  if (tokensPerSecond === null) return "--/s"
  if (tokensPerSecond === 0) return "0/s"
  return source === "estimated"
    ? `≈${tokensPerSecond}/s`
    : `${tokensPerSecond}/s`
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
  tokenRate,
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
  const tokenRateLabel =
    tokenRate.tokensPerSecond === null
      ? tLive("outputRatePending")
      : tokenRate.source === "estimated"
        ? tLive("outputRateEstimated", {
            value: tokenRate.tokensPerSecond,
          })
        : tLive("outputRateMeasured", {
            value: tokenRate.tokensPerSecond,
          })
  const editSummary = `${editStats.files}F +${formatCompactInt(
    editStats.additions,
    compactFormatter
  )}/-${formatCompactInt(editStats.deletions, compactFormatter)}`

  return (
    <div
      className="prooflane-composer-runtime-bar grid min-w-0 grid-cols-[minmax(12rem,1fr)_minmax(0,auto)_auto] items-center gap-x-3 overflow-hidden px-3 py-1.5 text-xs text-muted-foreground"
      data-composer-runtime-state={status}
      data-testid="composer-runtime-bar"
    >
      <div
        className="flex min-w-0 items-center gap-x-3 overflow-hidden"
        data-composer-runtime-slot="primary"
        data-testid="composer-runtime-primary"
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

        {phase !== null && <span className="shrink-0">{tLive(phase)}</span>}

        <span
          aria-atomic="true"
          aria-live="polite"
          className="inline-flex min-w-0 flex-1 items-center gap-1.5"
          role="status"
        >
          <span
            aria-hidden="true"
            className="prooflane-composer-status-dot h-1.5 w-1.5 shrink-0 rounded-full"
          />
          <span className="truncate" title={statusLabel}>
            {statusLabel}
          </span>
        </span>

        {elapsedLabel !== null && (
          <span
            className="inline-flex shrink-0 items-center gap-1"
            data-testid="composer-status-elapsed"
          >
            <Timer aria-hidden="true" className="h-3 w-3 shrink-0" />
            {elapsedLabel}
          </span>
        )}

        {activeRun && (
          <span
            className="prooflane-composer-runtime-token-rate inline-flex shrink-0 items-center gap-1"
            aria-label={tokenRateLabel}
            data-testid="composer-token-rate"
          >
            <Gauge aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span aria-hidden="true" dir="ltr">
              {formatTokenRate(tokenRate)}
            </span>
            <span className="sr-only">{tokenRateLabel}</span>
          </span>
        )}
      </div>

      <div
        className="prooflane-composer-runtime-secondary flex min-w-0 items-center justify-self-end gap-x-3 overflow-hidden"
        data-composer-runtime-priority="compressible"
        data-composer-runtime-slot="secondary"
        data-testid="composer-runtime-secondary"
      >
        {editStats.files > 0 && (
          <span className="prooflane-composer-runtime-secondary-stat flex min-w-0 items-center gap-1">
            <FilePenLine aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="prooflane-composer-runtime-secondary-label min-w-0 truncate">
              {editSummary}
            </span>
          </span>
        )}

        {toolCallLabel !== null && (
          <span className="prooflane-composer-runtime-secondary-stat flex min-w-0 items-center gap-1">
            <Wrench aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="prooflane-composer-runtime-secondary-label min-w-0 truncate">
              {toolCallLabel}
            </span>
          </span>
        )}
      </div>

      {status === "failed" && onRetry && (
        <button
          aria-label={retryLabel}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          data-composer-runtime-slot="action"
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
  const tokenRate = useLiveTokenRate({
    active: activeRun,
    liveMessage,
  })

  return (
    <ComposerRuntimeBarContent
      {...props}
      editStats={editStats}
      phase={phase}
      toolCallCount={toolCallCount}
      tokenRate={tokenRate}
    />
  )
}

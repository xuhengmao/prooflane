"use client"

import { Eye, Pencil, RotateCcw, Trash2 } from "lucide-react"

interface RelayCardData {
  sourceConversationId: number
  estimatedTokens: number
  allowedTokens: number
  invalidReason: string | null
  status: string
  snapshot: {
    stats: {
      messageCount: number
      fileCount: number
      todoCount: number
    }
  }
}

interface RelayContextCardProps {
  relay: RelayCardData
  sourceTitle?: string | null
  disabled?: boolean
  onPreview: () => void
  onAdjust: () => void
  onRemove: () => void
  onUndo: () => void
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

export function RelayContextCard({
  relay,
  sourceTitle,
  disabled = false,
  onPreview,
  onAdjust,
  onRemove,
  onUndo,
}: RelayContextCardProps) {
  const sourceLabel =
    sourceTitle?.trim() || `会话 #${relay.sourceConversationId}`
  if (relay.status === "removed") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span>10 秒内可撤销</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onUndo}
          title="撤销移除"
          aria-label="撤销移除"
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" aria-hidden /> 撤销移除
        </button>
      </div>
    )
  }

  const overBudget = relay.invalidReason === "relay_budget_exceeded"
  const { messageCount, fileCount, todoCount } = relay.snapshot.stats
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="max-w-full truncate font-medium" title={sourceLabel}>
            {sourceLabel}
          </span>
          <span
            className={
              overBudget ? "text-destructive" : "text-muted-foreground"
            }
          >
            {formatTokens(relay.estimatedTokens)} /{" "}
            {formatTokens(relay.allowedTokens)}
          </span>
          {overBudget && (
            <span className="text-destructive">上下文预算超限</span>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">
          {messageCount} 条消息 · {fileCount} 个文件 · {todoCount} 项待办
        </p>
      </div>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={onPreview}
          title="查看"
          aria-label="查看"
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onAdjust}
          title="调整范围"
          aria-label="调整范围"
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          title="移除"
          aria-label="移除"
          className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  )
}

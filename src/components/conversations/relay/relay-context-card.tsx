"use client"

import { Eye, Pencil, RotateCcw, Trash2 } from "lucide-react"

interface RelayCardData {
  estimatedTokens: number
  allowedTokens: number
  invalidReason: string | null
  status: string
}

interface RelayContextCardProps {
  relay: RelayCardData
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
  onPreview,
  onAdjust,
  onRemove,
  onUndo,
}: RelayContextCardProps) {
  if (relay.status === "removed") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span>10 秒内可撤销</span>
        <button
          type="button"
          onClick={onUndo}
          title="撤销移除"
          aria-label="撤销移除"
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="size-3.5" aria-hidden /> 撤销移除
        </button>
      </div>
    )
  }

  const overBudget = relay.invalidReason === "relay_budget_exceeded"
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="font-medium">历史接力</span>
      <span
        className={overBudget ? "text-destructive" : "text-muted-foreground"}
      >
        {formatTokens(relay.estimatedTokens)} /{" "}
        {formatTokens(relay.allowedTokens)}
      </span>
      {overBudget && <span className="text-destructive">上下文预算超限</span>}
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onPreview}
          title="查看"
          aria-label="查看"
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Eye className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onAdjust}
          title="调整范围"
          aria-label="调整范围"
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="移除"
          aria-label="移除"
          className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  )
}

"use client"

import { Eye, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

interface RelayCardData {
  sourceConversationId: number
  scope: {
    scopeType: "summary" | "recent_rounds" | "custom_rounds"
    selectedRoundIds: string[]
  }
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
  onRefresh: () => void
}

export function RelayContextCard({
  relay,
  sourceTitle,
  disabled = false,
  onPreview,
  onAdjust,
  onRemove,
  onUndo,
  onRefresh,
}: RelayContextCardProps) {
  const t = useTranslations("Folder.chat.relay")
  const locale = useLocale()
  const formatTokens = (value: number) =>
    new Intl.NumberFormat(locale).format(value)
  const scopeLabel =
    relay.scope.scopeType === "recent_rounds"
      ? t("recentRounds")
      : relay.scope.scopeType === "custom_rounds"
        ? t("customRoundsCount", {
            count: relay.scope.selectedRoundIds.length,
          })
        : t("summary")
  const sourceLabel =
    sourceTitle?.trim() ||
    t("conversationFallback", { id: relay.sourceConversationId })
  if (relay.status === "removed") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        <span>{t("removed")}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onUndo}
          title={t("undo")}
          aria-label={t("undo")}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" aria-hidden /> {t("undo")}
        </button>
      </div>
    )
  }

  const overBudget = relay.invalidReason === "relay_budget_exceeded"
  const sourceUpdated = relay.invalidReason === "relay_rounds_changed"
  const modelChanged = relay.invalidReason === "relay_model_changed"
  const sendUncertain = relay.invalidReason === "relay_send_uncertain"
  const sourceUnavailable =
    relay.invalidReason === "relay_source_not_found" ||
    relay.invalidReason === "relay_source_unavailable"
  const recoveryLabel = sourceUpdated
    ? t("refreshContent")
    : modelChanged || sendUncertain || sourceUnavailable
      ? t("reprepare")
      : null
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
            {t("tokenBudgetValue", {
              used: formatTokens(relay.estimatedTokens),
              allowed: formatTokens(relay.allowedTokens),
            })}
          </span>
          {overBudget && (
            <span className="text-destructive">{t("budgetExceeded")}</span>
          )}
          {sourceUpdated && (
            <span className="text-destructive">{t("sourceUpdated")}</span>
          )}
          {modelChanged && (
            <span className="text-destructive">{t("modelChanged")}</span>
          )}
          {sendUncertain && (
            <span className="text-destructive">{t("sendUncertain")}</span>
          )}
          {sourceUnavailable && (
            <span className="text-destructive">{t("sourceUnavailable")}</span>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">
          <span>{t("scopeValue", { scope: scopeLabel })}</span>
          <span aria-hidden> · </span>
          <span>
            {t("stats", {
              messages: messageCount,
              files: fileCount,
              todos: todoCount,
            })}
          </span>
        </p>
      </div>
      <span className="ml-auto flex items-center gap-1">
        {recoveryLabel && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRefresh}
            title={recoveryLabel}
            aria-label={recoveryLabel}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {recoveryLabel}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={onPreview}
          title={t("view")}
          aria-label={t("view")}
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onAdjust}
          title={t("adjust")}
          aria-label={t("adjust")}
          className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          title={t("remove")}
          aria-label={t("remove")}
          className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </span>
    </div>
  )
}

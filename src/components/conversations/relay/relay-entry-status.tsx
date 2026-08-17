"use client"

import { Loader2, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

interface RelayEntryStatusProps {
  state: "loading" | "error"
  onRetry: () => void
  onClear: () => void
}

export function RelayEntryStatus({
  state,
  onRetry,
  onClear,
}: RelayEntryStatusProps) {
  const t = useTranslations("Folder.chat.relay")

  if (state === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        <span>{t("entryLoading")}</span>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{t("entryError")}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        {t("retry")}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("remove")}
      </button>
    </div>
  )
}

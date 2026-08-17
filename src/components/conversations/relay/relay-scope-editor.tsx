"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import type { RelayRound, RelayScopeSelection } from "@/lib/types"

interface RelayScopeEditorProps {
  rounds: RelayRound[]
  value?: RelayScopeSelection
  summaryState?: "idle" | "loading" | "error"
  disabled?: boolean
  onChange: (scope: RelayScopeSelection) => void
}

function recentRoundIds(rounds: RelayRound[]): string[] {
  return rounds.slice(-10).map((round) => round.id)
}

export function RelayScopeEditor({ value, ...props }: RelayScopeEditorProps) {
  const resetKey = value
    ? `${value.scopeType}:${value.selectedRoundIds.join(",")}`
    : `rounds:${props.rounds.map((round) => round.id).join(",")}`

  return <RelayScopeEditorContent key={resetKey} value={value} {...props} />
}

function RelayScopeEditorContent({
  rounds,
  value,
  summaryState = "idle",
  disabled = false,
  onChange,
}: RelayScopeEditorProps) {
  const t = useTranslations("Folder.chat.relay")
  const defaultScope = useMemo<RelayScopeSelection>(
    () => ({
      scopeType: "recent_rounds",
      selectedRoundIds: recentRoundIds(rounds),
    }),
    [rounds]
  )
  const [scope, setScope] = useState(value ?? defaultScope)

  const commit = (next: RelayScopeSelection) => {
    if (disabled) return
    setScope(next)
    onChange(next)
  }
  const customIds =
    scope.scopeType === "custom_rounds" ? scope.selectedRoundIds : []

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => commit(defaultScope)}
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("recentRounds")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            commit({ scopeType: "custom_rounds", selectedRoundIds: [] })
          }
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("customRounds")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => commit({ scopeType: "summary", selectedRoundIds: [] })}
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("summary")}
        </button>
      </div>
      {summaryState === "loading" && (
        <p className="text-xs text-muted-foreground">{t("summaryLoading")}</p>
      )}
      {summaryState === "error" && (
        <p className="text-xs text-destructive">{t("summaryUnavailable")}</p>
      )}
      {scope.scopeType !== "summary" && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {rounds.map((round) => {
            const checked =
              scope.scopeType === "recent_rounds"
                ? scope.selectedRoundIds.includes(round.id)
                : customIds.includes(round.id)
            return (
              <label
                key={round.id}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  aria-label={round.id}
                  checked={checked}
                  disabled={disabled || scope.scopeType === "recent_rounds"}
                  onChange={() => {
                    const next = customIds.includes(round.id)
                      ? customIds.filter((id) => id !== round.id)
                      : [...customIds, round.id]
                    commit({
                      scopeType: "custom_rounds",
                      selectedRoundIds: next,
                    })
                  }}
                />
                <span className="truncate">
                  {round.userText || t("emptyRound")}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

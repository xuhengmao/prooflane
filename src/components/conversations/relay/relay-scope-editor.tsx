"use client"

import { useMemo, useState } from "react"
import type { RelayRound, RelayScopeSelection } from "@/lib/types"

interface RelayScopeEditorProps {
  rounds: RelayRound[]
  value?: RelayScopeSelection
  summaryState?: "idle" | "loading" | "error"
  onChange: (scope: RelayScopeSelection) => void
}

function recentRoundIds(rounds: RelayRound[]): string[] {
  return rounds.slice(-10).map((round) => round.id)
}

export function RelayScopeEditor({
  rounds,
  value,
  summaryState = "idle",
  onChange,
}: RelayScopeEditorProps) {
  const defaultScope = useMemo<RelayScopeSelection>(
    () => ({
      scopeType: "recent_rounds",
      selectedRoundIds: recentRoundIds(rounds),
    }),
    [rounds]
  )
  const [scope, setScope] = useState(value ?? defaultScope)

  const commit = (next: RelayScopeSelection) => {
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
          onClick={() => commit(defaultScope)}
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          最近 10 轮
        </button>
        <button
          type="button"
          onClick={() =>
            commit({ scopeType: "custom_rounds", selectedRoundIds: [] })
          }
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          自定义轮次
        </button>
        <button
          type="button"
          onClick={() => commit({ scopeType: "summary", selectedRoundIds: [] })}
          className="rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          摘要
        </button>
      </div>
      {summaryState === "loading" && (
        <p className="text-xs text-muted-foreground">正在生成摘要</p>
      )}
      {summaryState === "error" && (
        <p className="text-xs text-destructive">摘要暂不可用</p>
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
                  disabled={scope.scopeType === "recent_rounds"}
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
                <span className="truncate">{round.userText || "空白轮次"}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

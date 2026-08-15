"use client"

import { useState } from "react"
import { ArrowRightLeft, ChevronRight, FileText } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RelayProvenance, RelayScopeType, RelaySummary } from "@/lib/types"

interface RelayProvenanceItemProps {
  provenance: RelayProvenance
}

const SUMMARY_SECTIONS: Array<{
  key: Exclude<keyof RelaySummary, "files">
  label: string
}> = [
  { key: "goals", label: "目标" },
  { key: "decisions", label: "关键结论" },
  { key: "progress", label: "处理进度" },
  { key: "todos", label: "待办事项" },
  { key: "constraints", label: "约束" },
  { key: "openQuestions", label: "待确认问题" },
]

function scopeLabel(scope: RelayScopeType, rounds: number): string {
  switch (scope) {
    case "summary":
      return "精简摘要"
    case "recent_rounds":
      return `最近 ${rounds} 个完整轮次`
    case "custom_rounds":
      return `自定义 ${rounds} 个完整轮次`
  }
}

function consumedAtLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function RelayProvenanceItem({ provenance }: RelayProvenanceItemProps) {
  const [open, setOpen] = useState(false)
  const scope = scopeLabel(
    provenance.scope.scopeType,
    provenance.includedRounds.length
  )
  const consumedAt = consumedAtLabel(provenance.consumedAt)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-2 px-1 py-2 text-start text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <ArrowRightLeft
          className="size-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          已接续《{provenance.source.title}》
        </span>
        <span className="hidden shrink-0 text-[0.6875rem] text-muted-foreground/80 sm:inline">
          {scope}
        </span>
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[min(92vw,34rem)] sm:max-w-lg">
          <SheetHeader className="border-b">
            <SheetTitle>接力来源</SheetTitle>
            <p className="pr-8 text-sm text-muted-foreground">
              《{provenance.source.title}》 · {scope}
            </p>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-b py-4 text-xs">
              <dt className="text-muted-foreground">消息</dt>
              <dd>{provenance.stats.messageCount}</dd>
              <dt className="text-muted-foreground">文件</dt>
              <dd>{provenance.stats.fileCount}</dd>
              <dt className="text-muted-foreground">待办</dt>
              <dd>{provenance.stats.todoCount}</dd>
              {consumedAt ? (
                <>
                  <dt className="text-muted-foreground">接续时间</dt>
                  <dd>{consumedAt}</dd>
                </>
              ) : null}
            </dl>

            {provenance.summary ? (
              <section className="border-b py-4">
                <h3 className="mb-3 text-sm font-medium">摘要</h3>
                <div className="space-y-3">
                  {SUMMARY_SECTIONS.map(({ key, label }) => {
                    const values = provenance.summary?.[key] ?? []
                    return values.length > 0 ? (
                      <div key={key}>
                        <h4 className="mb-1 text-xs text-muted-foreground">
                          {label}
                        </h4>
                        <ul className="space-y-1 text-sm">
                          {values.map((value, index) => (
                            <li key={`${key}-${index}`} className="break-words">
                              {value}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  })}
                </div>
              </section>
            ) : null}

            {provenance.includedRounds.length > 0 ? (
              <section className="border-b py-4">
                <h3 className="mb-3 text-sm font-medium">已接入轮次</h3>
                <div className="divide-y">
                  {provenance.includedRounds.map((round, index) => (
                    <div key={round.id} className="space-y-2 py-3 first:pt-0">
                      <p className="text-xs text-muted-foreground">
                        轮次 {index + 1}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {round.userText}
                      </p>
                      {round.assistantText ? (
                        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {round.assistantText}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {provenance.files.length > 0 ? (
              <section className="py-4">
                <h3 className="mb-3 text-sm font-medium">相关文件</h3>
                <ul className="space-y-2">
                  {provenance.files.map((file, index) => (
                    <li
                      key={`${file.path}-${file.sourceMessageId}-${index}`}
                      className="flex min-w-0 items-center gap-2 text-sm"
                    >
                      <FileText
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 break-all">{file.path}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

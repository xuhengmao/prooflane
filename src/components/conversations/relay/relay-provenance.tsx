"use client"

import { useState } from "react"
import { ArrowRightLeft, ChevronRight, FileText } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

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
}> = [
  { key: "goals" },
  { key: "decisions" },
  { key: "progress" },
  { key: "todos" },
  { key: "constraints" },
  { key: "openQuestions" },
]

function scopeLabel(
  scope: RelayScopeType,
  labels: {
    summary: string
    recentRounds: string
    customRounds: string
  }
): string {
  switch (scope) {
    case "summary":
      return labels.summary
    case "recent_rounds":
      return labels.recentRounds
    case "custom_rounds":
      return labels.customRounds
  }
}

function consumedAtLabel(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale)
}

export function RelayProvenanceItem({ provenance }: RelayProvenanceItemProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations("Folder.chat.relay")
  const locale = useLocale()
  const rounds = provenance.includedRounds.length
  const scope = scopeLabel(provenance.scope.scopeType, {
    summary: t("compactSummary"),
    recentRounds: t("recentCompleteRounds", { count: rounds }),
    customRounds: t("customCompleteRounds", { count: rounds }),
  })
  const consumedAt = consumedAtLabel(provenance.consumedAt, locale)
  const sourceTitle =
    provenance.source.title.trim() ||
    t("conversationFallback", { id: provenance.source.conversationId })

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
          {t("continuedFrom", { title: sourceTitle })}
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
            <SheetTitle>{t("provenanceTitle")}</SheetTitle>
            <p className="pr-8 text-sm text-muted-foreground">
              {t("continuedFrom", { title: sourceTitle })} · {scope}
            </p>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-b py-4 text-xs">
              <dt className="text-muted-foreground">{t("messagesLabel")}</dt>
              <dd>{provenance.stats.messageCount}</dd>
              <dt className="text-muted-foreground">{t("filesLabel")}</dt>
              <dd>{provenance.stats.fileCount}</dd>
              <dt className="text-muted-foreground">{t("todosLabel")}</dt>
              <dd>{provenance.stats.todoCount}</dd>
              {consumedAt ? (
                <>
                  <dt className="text-muted-foreground">{t("continuedAt")}</dt>
                  <dd>{consumedAt}</dd>
                </>
              ) : null}
            </dl>

            {provenance.summary ? (
              <section className="border-b py-4">
                <h3 className="mb-3 text-sm font-medium">{t("summary")}</h3>
                <div className="space-y-3">
                  {SUMMARY_SECTIONS.map(({ key }) => {
                    const values = provenance.summary?.[key] ?? []
                    return values.length > 0 ? (
                      <div key={key}>
                        <h4 className="mb-1 text-xs text-muted-foreground">
                          {t(`summarySections.${key}`)}
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
                <h3 className="mb-3 text-sm font-medium">
                  {t("includedRounds")}
                </h3>
                <div className="divide-y">
                  {provenance.includedRounds.map((round, index) => (
                    <div key={round.id} className="space-y-2 py-3 first:pt-0">
                      <p className="text-xs text-muted-foreground">
                        {t("roundNumber", { count: index + 1 })}
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
                <h3 className="mb-3 text-sm font-medium">
                  {t("relatedFiles")}
                </h3>
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

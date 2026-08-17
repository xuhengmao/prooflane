"use client"

import { Bot, FileText, UserRound, Wrench } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RelayContextPack, RelaySummary } from "@/lib/types"

interface RelayPreviewDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  relay: RelayContextPack | null
  sourceTitle?: string | null
}

const SUMMARY_SECTIONS: Array<{
  key: Exclude<keyof RelaySummary, "files">
  labelKey:
    | "summarySections.goals"
    | "summarySections.decisions"
    | "summarySections.progress"
    | "summarySections.todos"
    | "summarySections.constraints"
    | "summarySections.openQuestions"
}> = [
  { key: "goals", labelKey: "summarySections.goals" },
  { key: "decisions", labelKey: "summarySections.decisions" },
  { key: "progress", labelKey: "summarySections.progress" },
  { key: "todos", labelKey: "summarySections.todos" },
  { key: "constraints", labelKey: "summarySections.constraints" },
  { key: "openQuestions", labelKey: "summarySections.openQuestions" },
]

export function RelayPreviewDrawer({
  open,
  onOpenChange,
  relay,
  sourceTitle,
}: RelayPreviewDrawerProps) {
  const t = useTranslations("Folder.chat.relay")
  const locale = useLocale()
  const formatTokens = (value: number) =>
    new Intl.NumberFormat(locale).format(value)
  const scopeLabel = relay
    ? relay.scope.scopeType === "summary"
      ? t("compactSummary")
      : relay.scope.scopeType === "recent_rounds"
        ? t("recentCompleteRounds", {
            count: relay.snapshot.includedRounds.length,
          })
        : t("customCompleteRounds", {
            count: relay.snapshot.includedRounds.length,
          })
    : null
  const sourceLabel = relay
    ? sourceTitle?.trim() ||
      t("conversationFallback", { id: relay.sourceConversationId })
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh]">
        <SheetHeader>
          <SheetTitle>{t("preview")}</SheetTitle>
        </SheetHeader>
        <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 pb-6 text-sm">
          {relay ? (
            <div className="divide-y">
              <section className="space-y-2 pb-4">
                <h3 className="break-words text-base font-medium">
                  {sourceLabel}
                </h3>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("scope")}</dt>
                  <dd>{scopeLabel}</dd>
                  <dt className="text-muted-foreground">{t("contentStats")}</dt>
                  <dd>
                    {t("stats", {
                      messages: relay.snapshot.stats.messageCount,
                      files: relay.snapshot.stats.fileCount,
                      todos: relay.snapshot.stats.todoCount,
                    })}
                  </dd>
                  <dt className="text-muted-foreground">{t("tokenBudget")}</dt>
                  <dd>
                    {formatTokens(relay.estimatedTokens)} /{" "}
                    {formatTokens(relay.allowedTokens)}
                  </dd>
                </dl>
              </section>

              {relay.snapshot.summary ? (
                <section className="py-4">
                  <h3 className="mb-3 font-medium">
                    {t("conversationSummary")}
                  </h3>
                  <div className="space-y-3">
                    {SUMMARY_SECTIONS.map(({ key, labelKey }) => {
                      const values = relay.snapshot.summary?.[key] ?? []
                      return values.length > 0 ? (
                        <div key={key}>
                          <h4 className="mb-1 text-xs text-muted-foreground">
                            {t(labelKey)}
                          </h4>
                          <ul className="space-y-1">
                            {values.map((value, index) => (
                              <li
                                key={`${key}-${index}`}
                                className="break-words"
                              >
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

              {relay.snapshot.includedRounds.length > 0 ? (
                <section className="py-4">
                  <h3 className="mb-3 font-medium">
                    {t("includedConversation")}
                  </h3>
                  <div className="divide-y">
                    {relay.snapshot.includedRounds.map((round) => (
                      <div key={round.id} className="space-y-3 py-4 first:pt-0">
                        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
                          <UserRound
                            className="mt-0.5 size-4 text-muted-foreground"
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              {t("userLabel")}
                            </p>
                            <p className="whitespace-pre-wrap break-words">
                              {round.userText}
                            </p>
                          </div>
                        </div>
                        {round.assistantText ? (
                          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
                            <Bot
                              className="mt-0.5 size-4 text-primary"
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <p className="mb-1 text-xs font-medium text-muted-foreground">
                                {t("assistantLabel")}
                              </p>
                              <p className="whitespace-pre-wrap break-words">
                                {round.assistantText}
                              </p>
                            </div>
                          </div>
                        ) : null}
                        {round.tools.length > 0 ? (
                          <details
                            aria-label={t("toolCalls", {
                              count: round.tools.length,
                            })}
                            className="ml-7 text-xs"
                          >
                            <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              <Wrench className="size-3.5" aria-hidden />
                              {t("toolCalls", { count: round.tools.length })}
                            </summary>
                            <ul className="mt-1 space-y-3 border-l pl-5">
                              {round.tools.map((tool, index) => (
                                <li
                                  key={`${tool.toolUseId ?? tool.name}-${index}`}
                                  className="min-w-0 space-y-2 py-1"
                                >
                                  <div className="flex min-w-0 items-center justify-between gap-3">
                                    <span
                                      className="min-w-0 truncate font-medium"
                                      title={tool.name}
                                    >
                                      {tool.name}
                                    </span>
                                    <span
                                      className={
                                        tool.isError
                                          ? "shrink-0 text-destructive"
                                          : "shrink-0 text-muted-foreground"
                                      }
                                    >
                                      {tool.isError
                                        ? t("toolFailed")
                                        : t("toolCompleted")}
                                    </span>
                                  </div>
                                  <dl className="space-y-2">
                                    <div>
                                      <dt className="mb-1 text-muted-foreground">
                                        {t("input")}
                                      </dt>
                                      <dd className="whitespace-pre-wrap break-all bg-muted/50 px-2 py-1.5 font-mono text-[11px]">
                                        {tool.input || t("noInput")}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="mb-1 text-muted-foreground">
                                        {t("output")}
                                      </dt>
                                      <dd className="whitespace-pre-wrap break-all bg-muted/50 px-2 py-1.5 font-mono text-[11px]">
                                        {tool.output || t("noOutput")}
                                      </dd>
                                    </div>
                                  </dl>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {relay.snapshot.files.length > 0 ? (
                <section className="py-4">
                  <h3 className="mb-3 font-medium">{t("relatedFiles")}</h3>
                  <ul className="space-y-2">
                    {relay.snapshot.files.map((file, index) => (
                      <li
                        key={`${file.path}-${file.sourceMessageId}-${index}`}
                        className="flex min-w-0 items-start gap-2"
                      >
                        <FileText
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 break-all">{file.path}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">{t("emptyPreview")}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

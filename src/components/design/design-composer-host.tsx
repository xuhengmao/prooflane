"use client"

import { Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"

export function DesignComposerHost() {
  const t = useTranslations("Design")

  return (
    <section
      className="shrink-0 border-t border-border/60 bg-background px-4 py-3"
      data-testid="design-composer-host"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        <span>{t("composer.title")}</span>
      </div>
    </section>
  )
}

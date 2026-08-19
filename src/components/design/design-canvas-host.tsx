"use client"

import { Frame, MousePointer2, Shapes, Type } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function DesignCanvasHost({
  view,
}: {
  view: "design" | "prototype" | "run"
}) {
  const t = useTranslations("Design")

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/10">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <TooltipProvider delayDuration={300}>
          <ToolButton label={t("tools.select")} icon={<MousePointer2 />} />
          <ToolButton label={t("tools.frame")} icon={<Frame />} disabled />
          <ToolButton label={t("tools.text")} icon={<Type />} disabled />
          <ToolButton label={t("tools.shape")} icon={<Shapes />} disabled />
        </TooltipProvider>
        <span className="ml-auto text-xs text-muted-foreground">
          {view === "design"
            ? t("canvas.designMode")
            : t("canvas.readOnlyMode")}
        </span>
      </div>
      <div
        className="grid min-h-0 flex-1 place-items-center overflow-auto p-6"
        data-testid="design-canvas-host"
      >
        <div className="grid aspect-[4/3] w-full max-w-3xl place-items-center border border-dashed border-border/80 bg-background shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            {t("canvas.title")}
          </p>
        </div>
      </div>
    </section>
  )
}

function ToolButton({
  label,
  icon,
  disabled = false,
}: {
  label: string
  icon: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={label}
          >
            {icon}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

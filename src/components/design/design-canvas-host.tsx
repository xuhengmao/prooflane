"use client"

import { Frame, Minus, MousePointer2, Plus, Shapes, Type } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import type { DesignDocument } from "@/lib/design/ast"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DesignSvgCanvas } from "./design-svg-canvas"

export function DesignCanvasHost({
  view,
  zoom,
  onZoomChange,
  document,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
}: {
  view: "design" | "prototype" | "run"
  zoom: number
  onZoomChange: (zoom: number) => void
  document: DesignDocument
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  onMoveNode: (id: string, x: number, y: number) => void
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
        <div
          className="ml-2 flex items-center gap-1"
          aria-label={t("canvas.zoom")}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("canvas.zoomOut")}
            onClick={() => onZoomChange(zoom - 0.1)}
          >
            <Minus />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("canvas.zoomIn")}
            onClick={() => onZoomChange(zoom + 0.1)}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div
        className="grid min-h-0 flex-1 place-items-center overflow-auto p-6"
        data-testid="design-canvas-host"
      >
        <DesignSvgCanvas
          document={document}
          zoom={zoom}
          ariaLabel={t("canvas.label")}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onMoveNode={onMoveNode}
          readOnly={view !== "design"}
        />
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

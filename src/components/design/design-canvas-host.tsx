"use client"

import {
  Frame,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Shapes,
  Type,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent, WheelEvent } from "react"

import { Button } from "@/components/ui/button"
import type { DesignDocument } from "@/lib/design/ast"
import {
  clientPointToDocument,
  documentBounds,
  fitViewport,
  panViewport,
  type CanvasViewport,
  zoomAroundPoint,
} from "@/lib/design/canvas-viewport"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DesignSvgCanvas } from "./design-svg-canvas"

interface CanvasHostSize {
  width: number
  height: number
}

interface PanState {
  pointerId: number
  clientX: number
  clientY: number
}

export function DesignCanvasHost({
  artifactId,
  view,
  zoom,
  panX,
  panY,
  onZoomChange,
  onPanChange,
  document,
  selectedNodeIds,
  onSelectionChange,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
}: {
  artifactId?: string
  view: "design" | "prototype" | "run"
  zoom: number
  panX: number
  panY: number
  onZoomChange: (zoom: number) => void
  onPanChange: (panX: number, panY: number) => void
  document: DesignDocument
  selectedNodeIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  selectedNodeId: string | null
  onSelectNode?: (id: string | null) => void
  onMoveNode: (id: string, x: number, y: number) => void
}) {
  const t = useTranslations("Design")
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostSize, setHostSize] = useState<CanvasHostSize>({
    width: 1,
    height: 1,
  })
  const [viewport, setViewport] = useState<CanvasViewport>(() => {
    const bounds = documentBounds(document)
    return {
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      width: Math.max(1, hostSize.width),
      height: Math.max(1, hostSize.height),
      zoom,
    }
  })
  const [panState, setPanState] = useState<PanState | null>(null)
  const spacePressed = useRef(false)
  const fitKey = useRef<string | null>(null)
  const bounds = useMemo(() => documentBounds(document), [document])
  const effectiveHostSize = useMemo(
    () =>
      hostSize.width > 1 && hostSize.height > 1
        ? hostSize
        : { width: bounds.width, height: bounds.height },
    [bounds.height, bounds.width, hostSize]
  )

  const emitViewport = useCallback(
    (next: CanvasViewport) => {
      setViewport(next)
      const nextPanX = next.centerX - (bounds.x + bounds.width / 2)
      const nextPanY = next.centerY - (bounds.y + bounds.height / 2)
      onZoomChange(next.zoom)
      onPanChange(nextPanX, nextPanY)
    },
    [bounds, onPanChange, onZoomChange]
  )

  const fit = useCallback(() => {
    const next = fitViewport(bounds, effectiveHostSize, 48)
    emitViewport(next)
  }, [bounds, effectiveHostSize, emitViewport])

  const reset = useCallback(() => {
    emitViewport({
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      width: effectiveHostSize.width,
      height: effectiveHostSize.height,
      zoom: 1,
    })
  }, [bounds, effectiveHostSize, emitViewport])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setHostSize({ width: rect.width, height: rect.height })
      }
    }
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // The viewport mirrors persisted UI state; this is intentionally a synchronous bridge.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewport((current) => ({
      ...current,
      centerX: bounds.x + bounds.width / 2 + panX,
      centerY: bounds.y + bounds.height / 2 + panY,
      width: effectiveHostSize.width / zoom,
      height: effectiveHostSize.height / zoom,
      zoom,
    }))
  }, [bounds, effectiveHostSize, panX, panY, zoom])

  useEffect(() => {
    if (hostSize.width <= 1 || hostSize.height <= 1) return
    const documentKey = artifactId ?? document.rootId ?? document.revision
    if (fitKey.current === documentKey) return
    fitKey.current = documentKey
    // ResizeObserver delivers the first usable host size after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fit()
  }, [artifactId, document.revision, document.rootId, fit, hostSize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressed.current = true
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressed.current = false
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const host = hostRef.current
    if (!host) return
    const anchor = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      host.getBoundingClientRect(),
      viewport
    )
    const factor = event.deltaY < 0 ? 1.1 : 0.9
    emitViewport(zoomAroundPoint(viewport, viewport.zoom * factor, anchor))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const button = event.button ?? 1
    if (button !== 1 && !(button === 0 && spacePressed.current)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPanState({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!panState || panState.pointerId !== event.pointerId) return
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx =
      ((event.clientX - panState.clientX) / Math.max(1, rect.width)) *
      viewport.width
    const dy =
      ((event.clientY - panState.clientY) / Math.max(1, rect.height)) *
      viewport.height
    emitViewport(panViewport(viewport, { x: -dx, y: -dy }))
    setPanState({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }

  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panState?.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setPanState(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (["INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      emitViewport(
        zoomAroundPoint(viewport, viewport.zoom * 1.1, {
          x: viewport.centerX,
          y: viewport.centerY,
        })
      )
    } else if (event.key === "-") {
      event.preventDefault()
      emitViewport(
        zoomAroundPoint(viewport, viewport.zoom * 0.9, {
          x: viewport.centerX,
          y: viewport.centerY,
        })
      )
    } else if (event.key === "0") {
      event.preventDefault()
      reset()
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/10">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <TooltipProvider delayDuration={300}>
          <ToolButton label={t("tools.select")} icon={<MousePointer2 />} />
          <ToolButton label={t("tools.frame")} icon={<Frame />} disabled />
          <ToolButton label={t("tools.text")} icon={<Type />} disabled />
          <ToolButton label={t("tools.shape")} icon={<Shapes />} disabled />
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
              onClick={() =>
                emitViewport(
                  zoomAroundPoint(viewport, viewport.zoom - 0.1, {
                    x: viewport.centerX,
                    y: viewport.centerY,
                  })
                )
              }
            >
              <Minus />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums">
              {Math.round(viewport.zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("canvas.zoomIn")}
              onClick={() =>
                emitViewport(
                  zoomAroundPoint(viewport, viewport.zoom + 0.1, {
                    x: viewport.centerX,
                    y: viewport.centerY,
                  })
                )
              }
            >
              <Plus />
            </Button>
            <ToolButton
              label={t("canvas.fit")}
              icon={<Maximize2 />}
              onClick={fit}
            />
            <ToolButton
              label={t("canvas.reset")}
              icon={<RotateCcw />}
              onClick={reset}
            />
          </div>
        </TooltipProvider>
      </div>
      <div
        ref={hostRef}
        className="grid min-h-0 flex-1 place-items-center overflow-hidden"
        data-testid="design-canvas-host"
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onKeyDown={onKeyDown}
      >
        <DesignSvgCanvas
          document={document}
          viewport={viewport}
          ariaLabel={t("canvas.label")}
          selectedNodeIds={selectedNodeIds}
          onSelectionChange={onSelectionChange}
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
  onClick,
}: {
  label: string
  icon: React.ReactNode
  disabled?: boolean
  onClick?: () => void
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
            onClick={onClick}
          >
            {icon}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

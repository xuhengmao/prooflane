"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react"

import type { DesignBounds, DesignDocument, DesignNode } from "@/lib/design/ast"
import {
  clientPointToDocument,
  type CanvasViewport,
} from "@/lib/design/canvas-viewport"
import { createSceneIndex } from "@/lib/design/scene-index"

interface DesignSvgCanvasProps {
  document: DesignDocument
  viewport: CanvasViewport
  ariaLabel: string
  selectedNodeIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  selectedNodeId?: string | null
  onSelectNode?: (id: string | null) => void
  onMoveNode: (id: string, x: number, y: number) => void
  readOnly?: boolean
}

interface DragState {
  nodeId: string
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  previewX: number
  previewY: number
}

interface MarqueeState {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  active: boolean
}

export function DesignSvgCanvas(props: DesignSvgCanvasProps) {
  const {
    document,
    viewport,
    ariaLabel,
    selectedNodeIds: selectedNodeIdsProp,
    onSelectionChange,
    selectedNodeId,
    onSelectNode,
    onMoveNode,
    readOnly = false,
  } = props
  const selectedNodeIds =
    selectedNodeIdsProp ?? (selectedNodeId ? [selectedNodeId] : [])
  const [drag, setDrag] = useState<DragState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const suppressClick = useRef(false)
  // document.revision is included intentionally to match the SceneIndex lifecycle.
  const index = useMemo(
    () => createSceneIndex(document),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document, document.revision]
  )
  useEffect(() => () => index.dispose(), [index])
  const viewportBounds: DesignBounds = {
    x: viewport.centerX - viewport.width / 2,
    y: viewport.centerY - viewport.height / 2,
    width: viewport.width,
    height: viewport.height,
  }
  const viewportNodeIds = new Set(index.queryViewport(viewportBounds))
  const renderedNodeIds = new Set([
    ...viewportNodeIds,
    ...selectedNodeIds.filter(
      (id) => document.nodes.find((node) => node.id === id)?.visible !== false
    ),
    ...(drag ? [drag.nodeId] : []),
  ])
  const selectedNodes = document.nodes.filter(
    (node) =>
      selectedNodeIds.includes(node.id) && node.visible !== false && node.bounds
  )

  const notifySelection = (ids: string[]) => {
    const next = Array.from(new Set(ids))
    if (onSelectionChange) {
      onSelectionChange(next)
    } else {
      onSelectNode?.(next.length === 1 ? next[0] : null)
    }
  }

  const applyModifierSelection = (
    id: string,
    event: Pick<MouseEvent<SVGElement>, "shiftKey" | "metaKey" | "ctrlKey">
  ) => {
    if (!(event.shiftKey || event.metaKey || event.ctrlKey)) {
      notifySelection([id])
      return
    }
    if (selectedNodeIds.includes(id)) {
      notifySelection(selectedNodeIds.filter((entry) => entry !== id))
    } else {
      notifySelection([...selectedNodeIds, id])
    }
  }

  const selectAtPoint = (
    event: MouseEvent<SVGElement>,
    svg: SVGSVGElement,
    fallbackId?: string
  ) => {
    if (readOnly) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      if (fallbackId) applyModifierSelection(fallbackId, event)
      return
    }
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      rect,
      viewport
    )
    const [id] = index.hitTestPoint(point)
    if (id) applyModifierSelection(id, event)
  }

  const startDrag = (event: PointerEvent<SVGElement>, node: DesignNode) => {
    if (
      readOnly ||
      node.locked === true ||
      !node.bounds ||
      event.button !== 0 ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      svg.getBoundingClientRect(),
      viewport
    )
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    notifySelection([node.id])
    setDrag({
      nodeId: node.id,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX: node.bounds.x,
      originY: node.bounds.y,
      previewX: node.bounds.x,
      previewY: node.bounds.y,
    })
  }

  const previewDrag = (event: PointerEvent<SVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      svg.getBoundingClientRect(),
      viewport
    )
    setDrag((current) =>
      current && current.pointerId === event.pointerId
        ? {
            ...current,
            previewX: current.originX + point.x - current.startX,
            previewY: current.originY + point.y - current.startY,
          }
        : current
    )
  }

  const finishDrag = (event: PointerEvent<SVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      svg.getBoundingClientRect(),
      viewport
    )
    const x = drag.originX + point.x - drag.startX
    const y = drag.originY + point.y - drag.startY
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
    if (x !== drag.originX || y !== drag.originY) {
      onMoveNode(drag.nodeId, x, y)
    }
  }

  const startMarquee = (event: PointerEvent<SVGSVGElement>) => {
    if (readOnly || event.button !== 0 || event.target !== event.currentTarget)
      return
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      viewport
    )
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setMarquee({
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      active: false,
    })
  }

  const moveMarquee = (event: PointerEvent<SVGSVGElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId || drag) return
    const point = clientPointToDocument(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      viewport
    )
    const active =
      Math.abs(point.x - marquee.startX) > 3 ||
      Math.abs(point.y - marquee.startY) > 3
    setMarquee((current) =>
      current && current.pointerId === event.pointerId
        ? { ...current, currentX: point.x, currentY: point.y, active }
        : current
    )
  }

  const finishMarquee = (event: PointerEvent<SVGSVGElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId || drag) return
    const current = marquee
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setMarquee(null)
    if (current.active) {
      const ids = index.hitTestRect({
        x: current.startX,
        y: current.startY,
        width: current.currentX - current.startX,
        height: current.currentY - current.startY,
      })
      const modified = current.shiftKey || current.metaKey || current.ctrlKey
      if (!modified) notifySelection(ids)
      else if (current.shiftKey) notifySelection([...selectedNodeIds, ...ids])
      else notifySelection(selectedNodeIds.filter((id) => !ids.includes(id)))
      suppressClick.current = true
    } else if (!(current.shiftKey || current.metaKey || current.ctrlKey)) {
      notifySelection([])
    }
  }

  const onCanvasClick = (event: MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (event.target === event.currentTarget) {
      if (!(event.shiftKey || event.metaKey || event.ctrlKey))
        notifySelection([])
    } else {
      const target = event.target as Element
      const targetId = target.getAttribute("data-design-node-id")
      const fallbackId = document.nodes.find((node) => node.id === targetId)
        ?.locked
        ? undefined
        : (targetId ?? undefined)
      selectAtPoint(event, event.currentTarget, fallbackId)
    }
  }

  return (
    <svg
      className="block size-full bg-white shadow-sm"
      data-testid="design-svg-canvas"
      viewBox={`${viewport.centerX - viewport.width / 2} ${viewport.centerY - viewport.height / 2} ${viewport.width} ${viewport.height}`}
      role="listbox"
      aria-label={ariaLabel}
      onClick={onCanvasClick}
      onPointerDown={startMarquee}
      onPointerMove={moveMarquee}
      onPointerUp={finishMarquee}
      onPointerCancel={() => setMarquee(null)}
      onKeyDown={(event) => {
        if (!readOnly && event.key === "Escape") notifySelection([])
      }}
    >
      {document.nodes
        .filter((node) => renderedNodeIds.has(node.id))
        .map((node) => (
          <DesignSvgNode
            key={node.id}
            node={node}
            selected={selectedNodeIds.includes(node.id)}
            readOnly={readOnly}
            previewBounds={previewBounds(node, drag)}
            onClick={(event) => {
              const svg = event.currentTarget.ownerSVGElement
              if (svg) selectAtPoint(event, svg, node.id)
              event.stopPropagation()
            }}
            onKeyboardSelect={(event) => applyModifierSelection(node.id, event)}
            onPointerDown={(event) => startDrag(event, node)}
            onPointerMove={previewDrag}
            onPointerUp={finishDrag}
            onPointerCancel={() => setDrag(null)}
          />
        ))}
      {selectedNodes.length > 0 ? (
        <SelectionOutline
          bounds={unionBounds(
            selectedNodes.map(
              (node) => previewBounds(node, drag) ?? node.bounds!
            )
          )}
          multiple={selectedNodes.length > 1}
        />
      ) : null}
      {marquee?.active ? (
        <rect
          data-testid="design-selection-marquee"
          x={Math.min(marquee.startX, marquee.currentX)}
          y={Math.min(marquee.startY, marquee.currentY)}
          width={Math.abs(marquee.currentX - marquee.startX)}
          height={Math.abs(marquee.currentY - marquee.startY)}
          fill="#38bf63"
          fillOpacity="0.14"
          stroke="#38bf63"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
    </svg>
  )
}

function DesignSvgNode({
  node,
  selected,
  readOnly,
  previewBounds,
  onClick,
  onKeyboardSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  node: DesignNode
  selected: boolean
  readOnly: boolean
  previewBounds?: DesignBounds
  onClick: (event: MouseEvent<SVGElement>) => void
  onKeyboardSelect: (
    event: Pick<MouseEvent<SVGElement>, "shiftKey" | "metaKey" | "ctrlKey">
  ) => void
  onPointerDown: (event: PointerEvent<SVGElement>) => void
  onPointerMove: (event: PointerEvent<SVGElement>) => void
  onPointerUp: (event: PointerEvent<SVGElement>) => void
  onPointerCancel: () => void
}) {
  if (
    node.visible === false ||
    node.type === "document" ||
    node.type === "page"
  )
    return null

  const bounds = previewBounds ??
    node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  const selectable = !readOnly && node.locked !== true
  const interactiveProps = {
    "data-testid": `design-node-${node.id}`,
    "data-design-node-id": node.id,
    role: selectable ? "option" : undefined,
    tabIndex: selectable ? 0 : undefined,
    "aria-label": nodeLabel(node),
    "aria-selected": selectable ? selected : undefined,
    "aria-disabled": node.locked === true ? true : undefined,
    onClick: selectable ? onClick : undefined,
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (!selectable || (event.key !== "Enter" && event.key !== " ")) return
      event.preventDefault()
      onKeyboardSelect(event)
    },
    onPointerDown: selectable ? onPointerDown : undefined,
    onPointerMove: selectable ? onPointerMove : undefined,
    onPointerUp: selectable ? onPointerUp : undefined,
    onPointerCancel: selectable ? onPointerCancel : undefined,
  }

  if (node.type === "text") {
    const fontSize = styleNumber(node, "fontSize", 16)
    return (
      <text
        {...interactiveProps}
        x={bounds.x}
        y={bounds.y + fontSize}
        fill={styleString(node, "fill", "#111827")}
        fontFamily={styleString(node, "fontFamily", "Inter")}
        fontSize={fontSize}
        fontWeight={styleValue(node, "fontWeight", 400)}
        opacity={node.opacity ?? 1}
      >
        {node.text}
      </text>
    )
  }

  if (node.type === "image") {
    if (isRenderSafeImageRef(node.assetRef)) {
      return (
        <image
          {...interactiveProps}
          href={node.assetRef}
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          opacity={node.opacity ?? 1}
          preserveAspectRatio="xMidYMid slice"
        />
      )
    }
    return (
      <g {...interactiveProps}>
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="#e5e7eb"
          stroke="#9ca3af"
          strokeDasharray="8 6"
        />
        <path
          data-testid={`design-image-placeholder-${node.id}`}
          d={`M ${bounds.x + bounds.width * 0.2} ${bounds.y + bounds.height * 0.75} L ${bounds.x + bounds.width * 0.45} ${bounds.y + bounds.height * 0.45} L ${bounds.x + bounds.width * 0.62} ${bounds.y + bounds.height * 0.62} L ${bounds.x + bounds.width * 0.78} ${bounds.y + bounds.height * 0.35}`}
          fill="none"
          stroke="#6b7280"
          strokeWidth="3"
        />
      </g>
    )
  }

  return (
    <rect
      {...interactiveProps}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      rx={styleNumber(node, "borderRadius", 0)}
      fill={styleString(
        node,
        "fill",
        node.type === "frame" ? "#ffffff" : "#d1d5db"
      )}
      stroke={styleString(node, "stroke", "transparent")}
      strokeWidth={styleNumber(node, "strokeWidth", 0)}
      opacity={node.opacity ?? 1}
    />
  )
}

function SelectionOutline({
  bounds,
  multiple,
}: {
  bounds: DesignBounds
  multiple: boolean
}) {
  const handles = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height],
    [bounds.x + bounds.width, bounds.y + bounds.height],
  ]
  return (
    <g data-testid="design-selection-outline" pointerEvents="none">
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="none"
        stroke="#38bf63"
        strokeWidth="2"
        strokeDasharray={multiple ? "6 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {!multiple
        ? handles.map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r="5"
              fill="#ffffff"
              stroke="#38bf63"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))
        : null}
    </g>
  )
}

function unionBounds(bounds: DesignBounds[]): DesignBounds {
  const left = Math.min(...bounds.map((entry) => entry.x))
  const top = Math.min(...bounds.map((entry) => entry.y))
  const right = Math.max(...bounds.map((entry) => entry.x + entry.width))
  const bottom = Math.max(...bounds.map((entry) => entry.y + entry.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function previewBounds(
  node: DesignNode,
  drag: DragState | null
): DesignBounds | undefined {
  if (!node.bounds || drag?.nodeId !== node.id) return node.bounds
  return { ...node.bounds, x: drag.previewX, y: drag.previewY }
}

function nodeLabel(node: DesignNode): string {
  const name = node.metadata?.name
  return typeof name === "string" && name.trim()
    ? name
    : `${node.type} ${node.id}`
}

function isRenderSafeImageRef(value: string | undefined): value is string {
  return (
    typeof value === "string" && /^(?:https?:|data:image\/|blob:)/i.test(value)
  )
}

function styleValue(
  node: DesignNode,
  key: string,
  fallback: string | number
): string | number {
  const value = node.style?.[key]
  return typeof value === "string" || typeof value === "number"
    ? value
    : fallback
}

function styleString(node: DesignNode, key: string, fallback: string): string {
  const value = node.style?.[key]
  return typeof value === "string" ? value : fallback
}

function styleNumber(node: DesignNode, key: string, fallback: number): number {
  const value = node.style?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

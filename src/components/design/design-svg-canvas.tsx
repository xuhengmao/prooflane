"use client"

import { useState } from "react"
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react"

import type { DesignBounds, DesignDocument, DesignNode } from "@/lib/design/ast"
import {
  clientPointToDocument,
  type CanvasViewport,
} from "@/lib/design/canvas-viewport"

interface DesignSvgCanvasProps {
  document: DesignDocument
  viewport: CanvasViewport
  ariaLabel: string
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
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

export function DesignSvgCanvas(props: DesignSvgCanvasProps) {
  const {
    document,
    viewport,
    ariaLabel,
    selectedNodeId,
    onSelectNode,
    onMoveNode,
    readOnly = false,
  } = props
  const [drag, setDrag] = useState<DragState | null>(null)
  const selectedNode = document.nodes.find(
    (node) => node.id === selectedNodeId && node.visible !== false
  )

  const startDrag = (event: PointerEvent<SVGElement>, node: DesignNode) => {
    if (readOnly || node.locked === true || !node.bounds || event.button !== 0)
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
    onSelectNode(node.id)
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

  return (
    <svg
      className="block size-full bg-white shadow-sm"
      data-testid="design-svg-canvas"
      viewBox={`${viewport.centerX - viewport.width / 2} ${viewport.centerY - viewport.height / 2} ${viewport.width} ${viewport.height}`}
      role="listbox"
      aria-label={ariaLabel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelectNode(null)
      }}
      onKeyDown={(event) => {
        if (!readOnly && event.key === "Escape") onSelectNode(null)
      }}
    >
      {document.nodes.map((node) => (
        <DesignSvgNode
          key={node.id}
          node={node}
          selected={node.id === selectedNodeId}
          readOnly={readOnly}
          previewBounds={previewBounds(node, drag)}
          onSelectNode={onSelectNode}
          onPointerDown={(event) => startDrag(event, node)}
          onPointerMove={previewDrag}
          onPointerUp={finishDrag}
          onPointerCancel={() => setDrag(null)}
        />
      ))}
      {selectedNode?.bounds ? (
        <SelectionOutline
          bounds={previewBounds(selectedNode, drag) ?? selectedNode.bounds}
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
  onSelectNode,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  node: DesignNode
  selected: boolean
  readOnly: boolean
  previewBounds?: DesignBounds
  onSelectNode: (id: string | null) => void
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
    onClick: (event: MouseEvent<SVGElement>) => {
      event.stopPropagation()
      if (selectable) onSelectNode(node.id)
    },
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (!selectable || (event.key !== "Enter" && event.key !== " ")) return
      event.preventDefault()
      onSelectNode(node.id)
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

function SelectionOutline({ bounds }: { bounds: DesignBounds }) {
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
        vectorEffect="non-scaling-stroke"
      />
      {handles.map(([cx, cy]) => (
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
      ))}
    </g>
  )
}

function previewBounds(
  node: DesignNode,
  drag: DragState | null
): DesignBounds | undefined {
  if (!node.bounds || drag?.nodeId !== node.id) return node.bounds
  return {
    ...node.bounds,
    x: drag.previewX,
    y: drag.previewY,
  }
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

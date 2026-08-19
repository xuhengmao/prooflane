"use client"

import type { KeyboardEvent, MouseEvent } from "react"

import type { DesignBounds, DesignDocument, DesignNode } from "@/lib/design/ast"

interface DesignSvgCanvasProps {
  document: DesignDocument
  zoom: number
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  onMoveNode: (id: string, x: number, y: number) => void
  readOnly?: boolean
}

export function DesignSvgCanvas(props: DesignSvgCanvasProps) {
  const {
    document,
    zoom,
    selectedNodeId,
    onSelectNode,
    readOnly = false,
  } = props
  const viewport = documentViewport(document)
  const selectedNode = document.nodes.find(
    (node) => node.id === selectedNodeId && node.visible !== false
  )

  return (
    <svg
      className="block h-auto max-h-full w-auto max-w-full bg-white shadow-sm"
      data-testid="design-svg-canvas"
      viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
      role="listbox"
      aria-label="Design canvas"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelectNode(null)
      }}
    >
      {document.nodes.map((node) => (
        <DesignSvgNode
          key={node.id}
          node={node}
          selected={node.id === selectedNodeId}
          readOnly={readOnly}
          onSelectNode={onSelectNode}
        />
      ))}
      {selectedNode?.bounds ? (
        <SelectionOutline bounds={selectedNode.bounds} />
      ) : null}
    </svg>
  )
}

function DesignSvgNode({
  node,
  selected,
  readOnly,
  onSelectNode,
}: {
  node: DesignNode
  selected: boolean
  readOnly: boolean
  onSelectNode: (id: string | null) => void
}) {
  if (
    node.visible === false ||
    node.type === "document" ||
    node.type === "page"
  )
    return null

  const bounds = node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
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

function documentViewport(document: DesignDocument): DesignBounds {
  const root = document.nodes.find(
    (node) => node.id === document.rootId && node.bounds
  )
  if (root?.bounds) return root.bounds
  const bounded = document.nodes.flatMap((node) =>
    node.bounds && node.visible !== false ? [node.bounds] : []
  )
  if (bounded.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const x = Math.min(...bounded.map((bounds) => bounds.x))
  const y = Math.min(...bounded.map((bounds) => bounds.y))
  const right = Math.max(...bounded.map((bounds) => bounds.x + bounds.width))
  const bottom = Math.max(...bounded.map((bounds) => bounds.y + bounds.height))
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
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

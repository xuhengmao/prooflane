import type { DesignBounds, DesignDocument } from "./ast"

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 8

export interface CanvasViewport {
  centerX: number
  centerY: number
  width: number
  height: number
  zoom: number
}

interface Size {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface HostRect extends Size {
  left: number
  top: number
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function safeSize(value: number, fallback = 1): number {
  return Math.max(1, finite(value, fallback))
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value))
}

export function zoomAroundPoint(
  viewport: CanvasViewport,
  nextZoom: number,
  anchor: Point
): CanvasViewport {
  const currentZoom = clampZoom(viewport.zoom)
  const zoom = clampZoom(nextZoom)
  const width = safeSize(viewport.width) * (currentZoom / zoom)
  const height = safeSize(viewport.height) * (currentZoom / zoom)
  const left = viewport.centerX - viewport.width / 2
  const top = viewport.centerY - viewport.height / 2
  const ratioX = (anchor.x - left) / safeSize(viewport.width)
  const ratioY = (anchor.y - top) / safeSize(viewport.height)
  const nextLeft = anchor.x - ratioX * width
  const nextTop = anchor.y - ratioY * height

  return {
    centerX: nextLeft + width / 2,
    centerY: nextTop + height / 2,
    width,
    height,
    zoom,
  }
}

export function panViewport(
  viewport: CanvasViewport,
  delta: Point
): CanvasViewport {
  return {
    ...viewport,
    centerX: viewport.centerX + finite(delta.x, 0),
    centerY: viewport.centerY + finite(delta.y, 0),
    zoom: clampZoom(viewport.zoom),
    width: safeSize(viewport.width),
    height: safeSize(viewport.height),
  }
}

export function fitViewport(
  bounds: DesignBounds,
  host: Size,
  padding: number
): CanvasViewport {
  const width = safeSize(bounds.width)
  const height = safeSize(bounds.height)
  if (!(host.width > 0) || !(host.height > 0)) {
    return {
      centerX: bounds.x + width / 2,
      centerY: bounds.y + height / 2,
      width,
      height,
      zoom: 1,
    }
  }
  const hostWidth = safeSize(host.width)
  const hostHeight = safeSize(host.height)
  const inset = Math.max(0, finite(padding, 0))
  const availableWidth = Math.max(1, hostWidth - inset * 2)
  const availableHeight = Math.max(1, hostHeight - inset * 2)
  const zoom = clampZoom(Math.min(availableWidth / width, availableHeight / height))

  return {
    centerX: bounds.x + width / 2,
    centerY: bounds.y + height / 2,
    width: hostWidth / zoom,
    height: hostHeight / zoom,
    zoom,
  }
}

export function clientPointToDocument(
  client: Point,
  hostRect: HostRect,
  viewport: CanvasViewport
): Point {
  const width = safeSize(hostRect.width)
  const height = safeSize(hostRect.height)
  const viewWidth = safeSize(viewport.width)
  const viewHeight = safeSize(viewport.height)
  const left = viewport.centerX - viewWidth / 2
  const top = viewport.centerY - viewHeight / 2
  return {
    x: left + ((finite(client.x, hostRect.left) - hostRect.left) / width) * viewWidth,
    y: top + ((finite(client.y, hostRect.top) - hostRect.top) / height) * viewHeight,
  }
}

export function documentBounds(document: DesignDocument): DesignBounds {
  const root = document.nodes.find(
    (node) => node.id === document.rootId && node.bounds
  )
  if (root?.bounds) return { ...root.bounds }

  const bounded = document.nodes.flatMap((node) =>
    node.bounds && node.visible !== false ? [node.bounds] : []
  )
  if (bounded.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const x = Math.min(...bounded.map((value) => value.x))
  const y = Math.min(...bounded.map((value) => value.y))
  const right = Math.max(...bounded.map((value) => value.x + value.width))
  const bottom = Math.max(...bounded.map((value) => value.y + value.height))
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  }
}

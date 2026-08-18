import type { DesignDocument, DesignNode, DesignBounds } from "../ast"

export type RendererId = "dom-svg" | "canvaskit" | "webgl"

export interface RendererCapability {
  available: boolean
  reason?: string
  textPrecision: "native" | "approximate" | "unavailable"
  supportsAccessibilityProxy: boolean
}

export interface RendererViewport {
  width: number
  height: number
  scale: number
}

export interface TextMeasureStyle {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  lineHeight?: number
}

export interface TextMeasureResult {
  width: number
  height: number
  lineCount: number
}

export interface RenderResult {
  nodeCount: number
  durationMs: number
  element?: Element
}

export interface RendererAdapter {
  readonly id: RendererId
  readonly capability: RendererCapability
  load(document: DesignDocument): void
  render(viewport: RendererViewport, host?: HTMLElement): RenderResult
  hitTest(point: { x: number; y: number }): string[]
  select(region: DesignBounds): string[]
  measureText(text: string, style?: TextMeasureStyle): TextMeasureResult
  dispose(): void
}

export function descendants(
  document: DesignDocument,
  node: DesignNode
): DesignNode[] {
  const byId = new Map(document.nodes.map((entry) => [entry.id, entry]))
  const result: DesignNode[] = []
  for (const childId of node.children ?? []) {
    const child = byId.get(childId)
    if (!child) continue
    result.push(child, ...descendants(document, child))
  }
  return result
}

export function boundsOf(node: DesignNode): DesignBounds {
  return node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
}

export function isSelectableNode(node: DesignNode): boolean {
  return (
    node.visible !== false && node.type !== "document" && node.type !== "page"
  )
}

export function containsPoint(
  node: DesignNode,
  point: { x: number; y: number }
): boolean {
  const bounds = boundsOf(node)
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x <= bounds.x + bounds.width &&
    point.y <= bounds.y + bounds.height
  )
}

export function intersects(node: DesignNode, region: DesignBounds): boolean {
  const bounds = boundsOf(node)
  return !(
    bounds.x + bounds.width < region.x ||
    region.x + region.width < bounds.x ||
    bounds.y + bounds.height < region.y ||
    region.y + region.height < bounds.y
  )
}

export function measureTextFallback(
  text: string,
  style: TextMeasureStyle = {}
): TextMeasureResult {
  const fontSize = style.fontSize ?? 16
  const lineHeight = style.lineHeight ?? fontSize * 1.2
  const lines = text.split(/\r?\n/)
  const width = Math.max(
    0,
    ...lines.map((line) => line.length * fontSize * 0.55)
  )
  return { width, height: lines.length * lineHeight, lineCount: lines.length }
}

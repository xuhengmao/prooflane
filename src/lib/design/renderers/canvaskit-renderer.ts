import type { Font, Paint, Surface } from "canvaskit-wasm"
import type { DesignDocument, DesignNode } from "../ast"
import {
  boundsOf,
  containsPoint,
  intersects,
  isSelectableNode,
  measureTextFallback,
  type RendererAdapter,
  type RendererCapability,
  type RendererViewport,
  type RenderResult,
  type TextMeasureResult,
} from "./renderer"
import type { CanvasKitRuntime } from "./canvaskit-runtime"

export class CanvasKitRenderer implements RendererAdapter {
  readonly id = "canvaskit" as const
  readonly capability: RendererCapability
  private document?: DesignDocument
  private canvas?: HTMLCanvasElement
  private surface?: Surface
  private resources: Array<Paint | Font> = []
  private runtime?: CanvasKitRuntime

  constructor(runtime?: CanvasKitRuntime) {
    this.runtime = runtime
    this.capability = runtime
      ? {
          available: true,
          textPrecision: "approximate",
          supportsAccessibilityProxy: false,
        }
      : {
          available: false,
          reason: "CanvasKit WASM runtime was not injected",
          textPrecision: "unavailable",
          supportsAccessibilityProxy: false,
        }
  }

  load(document: DesignDocument): void {
    this.document = document
  }

  render(viewport: RendererViewport, host?: HTMLElement): RenderResult {
    if (!this.document) throw new Error("renderer_not_loaded")
    if (!this.capability.available)
      return { nodeCount: this.document.nodes.length, durationMs: 0 }
    const started = performance.now()
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(viewport.width * viewport.scale))
    canvas.height = Math.max(1, Math.round(viewport.height * viewport.scale))
    canvas.setAttribute("data-renderer", this.id)
    this.canvas?.remove()
    this.canvas = canvas
    this.releaseSurface()
    const runtime = this.runtime
    if (!runtime) throw new Error("canvaskit_runtime_unavailable")
    const surface = runtime.MakeCanvasSurface(canvas)
    if (!surface) throw new Error("canvaskit_surface_unavailable")
    this.surface = surface
    const drawingCanvas = surface.getCanvas()
    drawingCanvas.clear(runtime.Color(255, 255, 255, 1))
    drawingCanvas.scale(viewport.scale, viewport.scale)

    const fillPaint = new runtime.Paint()
    const strokePaint = new runtime.Paint()
    fillPaint.setAntiAlias(true)
    strokePaint.setAntiAlias(true)
    fillPaint.setStyle(runtime.PaintStyle.Fill)
    strokePaint.setStyle(runtime.PaintStyle.Stroke)
    this.resources.push(fillPaint, strokePaint)
    const fonts = new Map<number, Font>()

    for (const node of this.document.nodes) {
      if (!this.shouldDraw(node)) continue
      const bounds = boundsOf(node)
      if (node.type === "text") {
        const fontSize = this.numberStyle(node, "fontSize", 16)
        let font = fonts.get(fontSize)
        if (!font) {
          font = new runtime.Font(null, fontSize)
          fonts.set(fontSize, font)
          this.resources.push(font)
        }
        this.applyColor(
          fillPaint,
          String(node.style?.color ?? "#1d2433"),
          node.opacity ?? 1
        )
        drawingCanvas.drawText(
          node.text ?? "",
          bounds.x,
          bounds.y + fontSize,
          fillPaint,
          font
        )
        continue
      }

      const rect = runtime.XYWHRect(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
      )
      this.applyColor(
        fillPaint,
        String(
          node.style?.fill ?? (node.type === "image" ? "#d6d9df" : "#e7eef8")
        ),
        node.opacity ?? 1
      )
      drawingCanvas.drawRect(rect, fillPaint)
      if (typeof node.style?.stroke === "string") {
        this.applyColor(strokePaint, node.style.stroke, node.opacity ?? 1)
        strokePaint.setStrokeWidth(this.numberStyle(node, "strokeWidth", 1))
        drawingCanvas.drawRect(rect, strokePaint)
      }
    }
    surface.flush()
    host?.replaceChildren(canvas)
    return {
      nodeCount: this.document.nodes.length,
      durationMs: performance.now() - started,
      element: canvas,
    }
  }

  hitTest(point: { x: number; y: number }): string[] {
    return (this.document?.nodes ?? [])
      .filter((node) => isSelectableNode(node) && containsPoint(node, point))
      .map((node) => node.id)
  }

  select(region: {
    x: number
    y: number
    width: number
    height: number
  }): string[] {
    return (this.document?.nodes ?? [])
      .filter((node) => isSelectableNode(node) && intersects(node, region))
      .map((node) => node.id)
  }

  measureText(
    text: string,
    style?: {
      fontFamily?: string
      fontSize?: number
      fontWeight?: number | string
      lineHeight?: number
    }
  ): TextMeasureResult {
    return measureTextFallback(text, style)
  }

  dispose(): void {
    this.releaseSurface()
    this.canvas?.remove()
    this.canvas = undefined
    this.document = undefined
  }

  private applyColor(paint: Paint, color: string, opacity: number): void {
    if (!this.runtime) return
    try {
      paint.setColor(this.runtime.parseColorString(color))
    } catch {
      paint.setColor(this.runtime.Color(214, 217, 223, 1))
    }
    paint.setAlphaf(Math.max(0, Math.min(1, opacity)))
  }

  private numberStyle(node: DesignNode, key: string, fallback: number): number {
    const value = node.style?.[key]
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : fallback
  }

  private releaseSurface(): void {
    for (const resource of this.resources.splice(0)) resource.delete()
    this.surface?.delete()
    this.surface = undefined
  }

  private shouldDraw(node: DesignNode): boolean {
    return (
      node.visible !== false && node.type !== "document" && node.type !== "page"
    )
  }
}

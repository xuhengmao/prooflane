import type { DesignDocument } from "../ast"
import {
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

export class WebglRenderer implements RendererAdapter {
  readonly id = "webgl" as const
  readonly capability: RendererCapability
  private document?: DesignDocument
  private canvas?: HTMLCanvasElement

  constructor(
    canvasFactory: () => HTMLCanvasElement = () =>
      document.createElement("canvas")
  ) {
    try {
      const canvas = canvasFactory()
      const context = canvas.getContext("webgl2")
      this.capability = context
        ? {
            available: true,
            textPrecision: "approximate",
            supportsAccessibilityProxy: false,
          }
        : {
            available: false,
            reason: "WebGL2 context is unavailable",
            textPrecision: "unavailable",
            supportsAccessibilityProxy: false,
          }
    } catch (error) {
      this.capability = {
        available: false,
        reason:
          error instanceof Error
            ? error.message
            : "WebGL2 context probe failed",
        textPrecision: "unavailable",
        supportsAccessibilityProxy: false,
      }
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
    this.canvas?.remove()
    this.canvas = undefined
    this.document = undefined
  }
}

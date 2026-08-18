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

export interface CanvasKitRuntime {
  MakeCanvasSurface(canvas: HTMLCanvasElement): { flush(): void } | null
}

export class CanvasKitRenderer implements RendererAdapter {
  readonly id = "canvaskit" as const
  readonly capability: RendererCapability
  private document?: DesignDocument
  private canvas?: HTMLCanvasElement
  private surface?: { flush(): void }
  private runtime?: CanvasKitRuntime

  constructor(runtime?: CanvasKitRuntime) {
    this.runtime = runtime
    this.capability = runtime
      ? {
          available: true,
          textPrecision: "native",
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
    this.surface = this.runtime?.MakeCanvasSurface(canvas) ?? undefined
    this.surface?.flush()
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
    this.surface = undefined
    this.document = undefined
  }
}

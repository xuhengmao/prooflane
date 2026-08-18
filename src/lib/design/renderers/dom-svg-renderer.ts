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

const SVG_NS = "http://www.w3.org/2000/svg"

export class DomSvgRenderer implements RendererAdapter {
  readonly id = "dom-svg" as const
  readonly capability: RendererCapability = {
    available: true,
    textPrecision: "native",
    supportsAccessibilityProxy: true,
  }

  private document?: DesignDocument
  private root?: SVGSVGElement

  load(document: DesignDocument): void {
    this.document = document
  }

  render(viewport: RendererViewport, host?: HTMLElement): RenderResult {
    if (!this.document) throw new Error("renderer_not_loaded")
    const started = performance.now()
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("width", String(viewport.width))
    svg.setAttribute("height", String(viewport.height))
    svg.setAttribute(
      "viewBox",
      `0 0 ${viewport.width / viewport.scale} ${viewport.height / viewport.scale}`
    )
    svg.setAttribute("data-renderer", this.id)
    for (const node of this.document.nodes) {
      if (
        node.visible === false ||
        node.type === "document" ||
        node.type === "page"
      )
        continue
      const element = this.createNodeElement(node)
      if (element) svg.appendChild(element)
    }
    this.root?.remove()
    this.root = svg
    host?.replaceChildren(svg)
    return {
      nodeCount: this.document.nodes.length,
      durationMs: performance.now() - started,
      element: svg,
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
    if (this.root && typeof document !== "undefined") {
      const probe = document.createElementNS(SVG_NS, "text")
      probe.textContent = text
      probe.setAttribute("font-size", String(style?.fontSize ?? 16))
      this.root.appendChild(probe)
      const box =
        typeof probe.getBBox === "function" ? probe.getBBox() : undefined
      probe.remove()
      if (box && box.width > 0)
        return {
          width: box.width,
          height: box.height,
          lineCount: text.split(/\r?\n/).length,
        }
    }
    return measureTextFallback(text, style)
  }

  dispose(): void {
    this.root?.remove()
    this.root = undefined
    this.document = undefined
  }

  private createNodeElement(node: DesignNode): SVGElement | undefined {
    const bounds = boundsOf(node)
    const tag =
      node.type === "text" ? "text" : node.type === "image" ? "rect" : "rect"
    const element = document.createElementNS(SVG_NS, tag)
    element.setAttribute("data-node-id", node.id)
    element.setAttribute("x", String(bounds.x))
    element.setAttribute("y", String(bounds.y))
    element.setAttribute("width", String(bounds.width))
    element.setAttribute("height", String(bounds.height))
    element.setAttribute("opacity", String(node.opacity ?? 1))
    if (node.type === "text") {
      element.removeAttribute("height")
      element.textContent = node.text ?? ""
      element.setAttribute("font-size", String(node.style?.fontSize ?? 16))
      element.setAttribute("fill", String(node.style?.color ?? "currentColor"))
    } else {
      element.setAttribute("fill", String(node.style?.fill ?? "#d6d9df"))
      element.setAttribute("stroke", String(node.style?.stroke ?? "none"))
    }
    return element
  }
}

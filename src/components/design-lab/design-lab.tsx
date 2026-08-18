"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { DesignDocument } from "@/lib/design/ast"
import { CanvasKitRenderer } from "@/lib/design/renderers/canvaskit-renderer"
import { DomSvgRenderer } from "@/lib/design/renderers/dom-svg-renderer"
import { WebglRenderer } from "@/lib/design/renderers/webgl-renderer"
import type {
  RendererAdapter,
  RendererId,
} from "@/lib/design/renderers/renderer"

const FIXTURES: Record<string, DesignDocument> = {
  starter: {
    version: 1,
    revision: "design-lab-starter-r1",
    nodes: [
      { id: "page", type: "page", children: ["panel", "heading", "body"] },
      {
        id: "panel",
        type: "frame",
        parentId: "page",
        bounds: { x: 28, y: 28, width: 584, height: 324 },
        style: { fill: "#f6f7f9", stroke: "#d9dde5" },
      },
      {
        id: "heading",
        type: "text",
        parentId: "page",
        bounds: { x: 56, y: 68, width: 360, height: 40 },
        text: "Design Lab",
        style: { fontSize: 28, color: "#1d2433" },
      },
      {
        id: "body",
        type: "text",
        parentId: "page",
        bounds: { x: 56, y: 124, width: 460, height: 72 },
        text: "同一 AST · 三种渲染器 · 可复现基准",
        style: { fontSize: 18, color: "#536071" },
      },
    ],
  },
}

function createRenderer(id: RendererId): RendererAdapter {
  if (id === "dom-svg") return new DomSvgRenderer()
  if (id === "canvaskit") return new CanvasKitRenderer()
  return new WebglRenderer()
}

export function DesignLab() {
  const [fixtureId, setFixtureId] = useState("starter")
  const [rendererId, setRendererId] = useState<RendererId>("dom-svg")
  const [status, setStatus] = useState("等待渲染")
  const [nodeCount, setNodeCount] = useState(0)
  const [duration, setDuration] = useState(0)
  const capability = useMemo(
    () => createRenderer(rendererId).capability,
    [rendererId]
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const document = useMemo(() => FIXTURES[fixtureId], [fixtureId])

  // The effect owns the renderer DOM node and mirrors its measured result into the lab status panel.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const renderer = createRenderer(rendererId)
    renderer.load(document)
    if (!renderer.capability.available) {
      hostRef.current?.replaceChildren()
      setStatus(renderer.capability.reason ?? "渲染器不可用")
      setNodeCount(document.nodes.length)
      return () => renderer.dispose()
    }
    const result = renderer.render(
      { width: 640, height: 380, scale: 1 },
      hostRef.current ?? undefined
    )
    setNodeCount(result.nodeCount)
    setDuration(result.durationMs)
    setStatus("渲染完成")
    return () => renderer.dispose()
  }, [document, rendererId])
  /* eslint-enable react-hooks/set-state-in-effect */

  const sample = () => {
    setStatus(`已采样 ${nodeCount} 个节点 · ${duration.toFixed(2)}ms`)
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 24,
        background: "#f1f3f6",
        color: "#1d2433",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Prooflane Design Lab</h1>
          <p style={{ margin: "6px 0 0", color: "#667085", fontSize: 13 }}>
            开发验证页 · 不写入会话和项目数据
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={sample}>
            采样性能
          </button>
          <button type="button" onClick={() => setStatus("截图请求已记录")}>
            保存截图
          </button>
        </div>
      </header>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "220px minmax(0, 1fr)",
          gap: 16,
        }}
      >
        <aside
          style={{
            background: "#fff",
            border: "1px solid #dfe3ea",
            padding: 14,
            borderRadius: 6,
          }}
        >
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            场景
            <select
              value={fixtureId}
              onChange={(event) => setFixtureId(event.target.value)}
            >
              <option value="starter">starter</option>
            </select>
          </label>
          <label
            style={{ display: "grid", gap: 6, marginTop: 14, fontSize: 13 }}
          >
            渲染器
            <select
              value={rendererId}
              onChange={(event) =>
                setRendererId(event.target.value as RendererId)
              }
            >
              <option value="dom-svg">DOM / SVG</option>
              <option value="canvaskit">CanvasKit</option>
              <option value="webgl">WebGL2</option>
            </select>
          </label>
          <dl style={{ margin: "20px 0 0", fontSize: 12, lineHeight: 1.7 }}>
            <div>
              <dt style={{ display: "inline", color: "#667085" }}>节点：</dt>{" "}
              <dd style={{ display: "inline", margin: 0 }}>{nodeCount}</dd>
            </div>
            <div>
              <dt style={{ display: "inline", color: "#667085" }}>耗时：</dt>{" "}
              <dd style={{ display: "inline", margin: 0 }}>
                {duration.toFixed(2)}ms
              </dd>
            </div>
            <div>
              <dt style={{ display: "inline", color: "#667085" }}>文字：</dt>{" "}
              <dd style={{ display: "inline", margin: 0 }}>
                {capability?.textPrecision ?? "-"}
              </dd>
            </div>
          </dl>
        </aside>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dfe3ea",
            borderRadius: 6,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              fontSize: 12,
              color: "#667085",
            }}
          >
            <span>{status}</span>
            <span>{capability?.available ? "available" : "diagnostic"}</span>
          </div>
          <div
            ref={hostRef}
            data-testid="design-lab-canvas"
            style={{
              minHeight: 380,
              display: "grid",
              placeItems: "center",
              background: "#fafbfc",
              overflow: "auto",
            }}
          />
          {capability && !capability.available ? (
            <p
              role="status"
              style={{ color: "#a33a32", fontSize: 13, margin: "10px 0 0" }}
            >
              {capability.reason}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  )
}

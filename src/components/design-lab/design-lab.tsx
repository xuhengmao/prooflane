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
import {
  previewChangeSet,
  validateChangeSet,
} from "@/lib/design/ai/changeset-guard"
import { MockDesignAiProvider } from "@/lib/design/ai/mock-provider"

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

function createBenchmarkFixture(nodeCount: number): DesignDocument {
  const nodes: DesignDocument["nodes"] = [
    { id: "page", type: "page", children: [] },
  ]
  const columns = 20
  for (let index = 1; index < nodeCount; index += 1) {
    const x = (index % columns) * 32
    const y = Math.floor(index / columns) * 24
    const isText = index % 11 === 0
    const isImage = index % 17 === 0
    const id = `node-${index}`
    nodes.push({
      id,
      type: isText ? "text" : isImage ? "image" : "rectangle",
      parentId: "page",
      bounds: { x, y, width: 28, height: isText ? 18 : 20 },
      ...(isText
        ? {
            text:
              index % 33 === 0
                ? "Prooflane 设计验证 · 你好 🌐 שלום"
                : `节点 ${index}`,
            style: { fontSize: 10, color: "#344054" },
          }
        : isImage
          ? { assetRef: "fixtures/sample.png" }
          : { style: { fill: index % 2 ? "#e7eef8" : "#d9f2e1" } }),
    })
  }
  nodes[0].children = nodes.slice(1).map((node) => node.id)
  return {
    version: 1,
    revision: `design-lab-${nodeCount}-r1`,
    rootId: "page",
    nodes,
  }
}

const BENCHMARK_FIXTURES: Record<string, DesignDocument> = {
  "nodes-100": createBenchmarkFixture(100),
  "nodes-1000": createBenchmarkFixture(1_000),
  "nodes-10000": createBenchmarkFixture(10_000),
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
  const [aiStatus, setAiStatus] = useState("未运行 AI 验证")
  const [aiPreview, setAiPreview] = useState<string>()
  const capability = useMemo(
    () => createRenderer(rendererId).capability,
    [rendererId]
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const document = useMemo(
    () =>
      FIXTURES[fixtureId] ?? BENCHMARK_FIXTURES[fixtureId] ?? FIXTURES.starter,
    [fixtureId]
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedFixture = params.get("fixture")
    const requestedRenderer = params.get("renderer")
    const fixtureTimer =
      requestedFixture &&
      (FIXTURES[requestedFixture] || BENCHMARK_FIXTURES[requestedFixture])
        ? window.setTimeout(() => setFixtureId(requestedFixture), 0)
        : undefined
    const rendererTimer =
      requestedRenderer &&
      ["dom-svg", "canvaskit", "webgl"].includes(requestedRenderer)
        ? window.setTimeout(
            () => setRendererId(requestedRenderer as RendererId),
            0
          )
        : undefined
    return () => {
      if (fixtureTimer) window.clearTimeout(fixtureTimer)
      if (rendererTimer) window.clearTimeout(rendererTimer)
    }
  }, [])

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

  const runAiValidation = async () => {
    const provider = new MockDesignAiProvider()
    try {
      const changeSet = await provider.generateChangeSet({
        fixtureId,
        document,
        prompt: "由 Mock AI 生成的标题",
      })
      const guard = validateChangeSet(changeSet, document, {
        allowedNodeIds: changeSet.targetNodeIds,
      })
      if (!guard.ok) {
        setAiStatus(`守卫拒绝：${guard.errors.join(", ")}`)
        setAiPreview(undefined)
        return
      }
      const preview = previewChangeSet(document, changeSet, changeSet.riskLevel)
      setAiStatus("ChangeSet 已通过守卫，等待用户确认")
      setAiPreview(
        `${preview.changedNodeIds.length} 个节点将被修改 · ${preview.beforeRevision} → ${preview.afterRevision}`
      )
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "AI 验证失败")
      setAiPreview(undefined)
    }
  }

  return (
    <main
      data-fixture-id={fixtureId}
      data-renderer-id={rendererId}
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
          <button type="button" onClick={() => void runAiValidation()}>
            Validate ChangeSet
          </button>
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
              <option value="nodes-100">nodes-100</option>
              <option value="nodes-1000">nodes-1000</option>
              <option value="nodes-10000">nodes-10000</option>
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
            data-testid="design-lab-ai-status"
            style={{ marginBottom: 10, fontSize: 12, color: "#536071" }}
          >
            {aiStatus}
            {aiPreview ? ` · ${aiPreview}` : ""}
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

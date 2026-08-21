import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createFixture,
  hashOperationSequence,
} from "./design-fixtures/generate-fixtures.mjs"
import { waitForTerminalRender } from "./design-benchmark.mjs"
import { generateReport } from "./design-report.mjs"

test("基准截图等待当前渲染器进入终态", async () => {
  let selected
  let options
  const page = {
    locator(selector) {
      selected = selector
      return {
        async waitFor(value) {
          options = value
        },
      }
    },
  }

  await waitForTerminalRender(page, 12_345)

  assert.match(selected, /data-render-state="completed"/)
  assert.match(selected, /data-render-state="unavailable"/)
  assert.match(selected, /data-render-state="failed"/)
  assert.deepEqual(options, { timeout: 12_345 })
})

test("生成固定规模且包含国际文本和图片引用的 AST", () => {
  for (const size of [100, 1_000, 10_000]) {
    const fixture = createFixture(size)
    assert.equal(fixture.document.nodes.length, size)
    assert.equal(fixture.nodeCount, size)
    assert.match(fixture.operationSequenceHash, /^[a-f0-9]{64}$/)
    assert.ok(
      fixture.document.nodes.some((node) => node.text?.includes("Prooflane"))
    )
    assert.ok(
      fixture.document.nodes.some((node) =>
        /[\u3400-\u9fff]/u.test(node.text ?? "")
      )
    )
    assert.ok(
      fixture.document.nodes.some((node) =>
        /[\u{1f300}-\u{1faff}]/u.test(node.text ?? "")
      )
    )
    assert.ok(
      fixture.document.nodes.some((node) =>
        /[\u0590-\u08ff]/u.test(node.text ?? "")
      )
    )
    assert.ok(
      fixture.document.nodes.some(
        (node) => node.type === "image" && node.assetRef
      )
    )
  }
})

test("操作序列哈希在重复生成时稳定", () => {
  const first = createFixture(1_000)
  const second = createFixture(1_000)
  assert.deepEqual(first.operations, second.operations)
  assert.equal(first.operationSequenceHash, second.operationSequenceHash)
  assert.equal(
    first.operationSequenceHash,
    hashOperationSequence(first.operations)
  )
})

test("报告区分 unavailable 和 failed，不将其记为通过", async () => {
  const artifactDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "prooflane-des0-report-")
  )
  await fs.mkdir(path.join(artifactDir, "screenshots", "dom-svg"), {
    recursive: true,
  })
  await fs.mkdir(path.join(artifactDir, "screenshots", "canvaskit"), {
    recursive: true,
  })
  await fs.mkdir(path.join(artifactDir, "screenshots", "webgl"), {
    recursive: true,
  })
  await fs.mkdir(path.join(artifactDir, "performance"), { recursive: true })
  await fs.writeFile(
    path.join(artifactDir, "screenshots", "dom-svg", "small.json"),
    JSON.stringify({
      renderer: "dom-svg",
      fixture: "small",
      status: "passed",
      durationMs: 4,
    })
  )
  await fs.writeFile(
    path.join(artifactDir, "screenshots", "canvaskit", "small.json"),
    JSON.stringify({
      renderer: "canvaskit",
      fixture: "small",
      status: "unavailable",
      diagnostic: "CanvasKit WASM unavailable",
    })
  )
  await fs.writeFile(
    path.join(artifactDir, "screenshots", "webgl", "small.json"),
    JSON.stringify({
      renderer: "webgl",
      fixture: "small",
      status: "failed",
      diagnostic: "navigation failed",
    })
  )

  const result = await generateReport({ artifactDir })
  assert.equal(result.summary.passed, 1)
  assert.equal(result.summary.unavailable, 1)
  assert.equal(result.summary.failed, 1)
  assert.match(result.markdown, /unavailable/)
  assert.match(result.markdown, /failed/)
  assert.match(result.markdown, /不可用|失败/u)
})

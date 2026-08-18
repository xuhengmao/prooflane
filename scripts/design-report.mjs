import fs from "node:fs/promises"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

const renderers = ["dom-svg", "canvaskit", "webgl"]
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

async function jsonFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dir, entry.name))
  } catch {
    return []
  }
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(pngSignature))
    throw new Error("unsupported_png")
  let offset = 8
  let width
  let height
  let idat = Buffer.alloc(0)
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error("unsupported_png_format")
    }
    if (type === "IDAT") idat = Buffer.concat([idat, data])
    if (type === "IEND") break
  }
  if (!width || !height) throw new Error("png_dimensions_missing")
  const raw = zlib.inflateSync(idat)
  const stride = width * 4
  const pixels = Buffer.alloc(height * stride)
  let sourceOffset = 0
  for (let row = 0; row < height; row += 1) {
    const filter = raw[sourceOffset++]
    const current = raw.subarray(sourceOffset, sourceOffset + stride)
    sourceOffset += stride
    const target = pixels.subarray(row * stride, (row + 1) * stride)
    const previous = row
      ? pixels.subarray((row - 1) * stride, row * stride)
      : null
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? target[index - 4] : 0
      const up = previous?.[index] ?? 0
      const upperLeft = index >= 4 ? (previous?.[index - 4] ?? 0) : 0
      const value = current[index]
      if (filter === 0) target[index] = value
      else if (filter === 1) target[index] = (value + left) & 255
      else if (filter === 2) target[index] = (value + up) & 255
      else if (filter === 3)
        target[index] = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) {
        const estimate = left + up - upperLeft
        const pa = Math.abs(estimate - left)
        const pb = Math.abs(estimate - up)
        const pc = Math.abs(estimate - upperLeft)
        target[index] =
          (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) &
          255
      } else throw new Error("unsupported_png_filter")
    }
  }
  return { width, height, pixels }
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 4 + 1)] = 0
    pixels.copy(
      raw,
      row * (width * 4 + 1) + 1,
      row * width * 4,
      (row + 1) * width * 4
    )
  }
  return Buffer.concat([
    pngSignature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

async function compareScreenshots(firstPath, secondPath, outputPath) {
  try {
    const first = decodePng(await fs.readFile(firstPath))
    const second = decodePng(await fs.readFile(secondPath))
    if (first.width !== second.width || first.height !== second.height) {
      return { status: "failed", diagnostic: "screenshot_dimensions_differ" }
    }
    const pixels = Buffer.alloc(first.pixels.length)
    let changedPixels = 0
    let totalDelta = 0
    for (let index = 0; index < first.pixels.length; index += 4) {
      const delta =
        Math.abs(first.pixels[index] - second.pixels[index]) +
        Math.abs(first.pixels[index + 1] - second.pixels[index + 1]) +
        Math.abs(first.pixels[index + 2] - second.pixels[index + 2])
      if (delta > 0) {
        changedPixels += 1
        totalDelta += delta
        pixels[index] = 220
        pixels[index + 1] = 55
        pixels[index + 2] = 47
        pixels[index + 3] = 255
      } else {
        pixels[index] = first.pixels[index]
        pixels[index + 1] = first.pixels[index + 1]
        pixels[index + 2] = first.pixels[index + 2]
        pixels[index + 3] = 72
      }
    }
    await fs.writeFile(
      outputPath,
      encodePng({ width: first.width, height: first.height, pixels })
    )
    return {
      status: "completed",
      changedPixels,
      totalPixels: first.width * first.height,
      meanDelta: changedPixels
        ? Number((totalDelta / changedPixels).toFixed(2))
        : 0,
      output: outputPath,
    }
  } catch (error) {
    return {
      status: "failed",
      diagnostic: error instanceof Error ? error.message : String(error),
    }
  }
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values, percentileValue) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.ceil((percentileValue / 100) * sorted.length) - 1
    )
  ]
}

export async function generateReport({
  artifactDir = path.resolve("des-0-artifacts"),
  copyTo,
} = {}) {
  const metadata = []
  for (const renderer of renderers) {
    const files = await jsonFiles(
      path.join(artifactDir, "screenshots", renderer)
    )
    for (const file of files) {
      try {
        metadata.push(JSON.parse(await fs.readFile(file, "utf8")))
      } catch {
        metadata.push({
          renderer,
          fixture: path.basename(file, ".json"),
          status: "failed",
          diagnostic: "metadata_invalid",
        })
      }
    }
  }
  const summary = {
    total: metadata.length,
    passed: metadata.filter((entry) => entry.status === "passed").length,
    unavailable: metadata.filter((entry) => entry.status === "unavailable")
      .length,
    failed: metadata.filter((entry) => entry.status === "failed").length,
    missing: metadata.length === 0 ? 1 : 0,
  }
  const diffResults = []
  const domMetadata = metadata.filter(
    (entry) => entry.renderer === "dom-svg" && entry.status === "passed"
  )
  for (const baseline of domMetadata) {
    for (const renderer of ["canvaskit", "webgl"]) {
      const candidate = metadata.find(
        (entry) =>
          entry.renderer === renderer && entry.fixture === baseline.fixture
      )
      if (
        !candidate ||
        candidate.status !== "passed" ||
        !baseline.screenshot ||
        !candidate.screenshot
      ) {
        diffResults.push({
          fixture: baseline.fixture,
          renderer,
          status: candidate?.status ?? "missing",
          diagnostic: candidate?.diagnostic ?? "screenshot_missing",
        })
        continue
      }
      const outputPath = path.join(
        artifactDir,
        "diffs",
        `${baseline.fixture}-${renderer}.png`
      )
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      diffResults.push({
        fixture: baseline.fixture,
        renderer,
        ...(await compareScreenshots(
          path.join(artifactDir, baseline.screenshot),
          path.join(artifactDir, candidate.screenshot),
          outputPath
        )),
      })
    }
  }
  const performancePath = path.join(
    artifactDir,
    "performance",
    "benchmark.json"
  )
  let performanceRecords = []
  try {
    performanceRecords =
      JSON.parse(await fs.readFile(performancePath, "utf8")).records ?? []
  } catch {
    performanceRecords = []
  }
  const durations = performanceRecords
    .filter(
      (entry) => entry.status === "passed" && Number.isFinite(entry.durationMs)
    )
    .map((entry) => entry.durationMs)
  const performance = {
    samples: durations.length,
    medianMs: median(durations),
    p95Ms: percentile(durations, 95),
    coldOpenTargetMs: 3000,
    frameP95TargetMs: 33,
    note: "当前采样为页面导航和渲染完成总耗时；帧级数据需由 Design Lab 性能采样补充。",
  }
  const reportJson = {
    generatedAt: new Date().toISOString(),
    summary,
    performance,
    diffs: diffResults,
    entries: metadata,
  }
  const markdown = [
    "# Prooflane DES-0 渲染基准报告",
    "",
    `生成时间：${reportJson.generatedAt}`,
    "",
    "## 结论输入",
    "",
    `- 总采样：${summary.total}`,
    `- 通过：${summary.passed}`,
    `- 不可用（unavailable）：${summary.unavailable}`,
    `- 失败（failed）：${summary.failed}`,
    `- 缺失产物：${summary.missing}`,
    "",
    "> unavailable 与 failed 均不会计入通过；缺少截图、性能或元数据时必须在 Go/No-Go 阶段阻断。",
    "",
    "## 性能",
    "",
    `- 有效样本：${performance.samples}`,
    `- 中位耗时：${performance.medianMs ?? "N/A"} ms（冷打开目标 <= ${performance.coldOpenTargetMs} ms）`,
    `- P95 耗时：${performance.p95Ms ?? "N/A"} ms（帧级目标 <= ${performance.frameP95TargetMs} ms）`,
    `- 说明：${performance.note}`,
    "",
    "## 渲染器明细",
    "",
    "| Fixture | Renderer | 状态 | 诊断 |",
    "| --- | --- | --- | --- |",
    ...metadata.map(
      (entry) =>
        `| ${entry.fixture ?? "-"} | ${entry.renderer ?? "-"} | ${entry.status ?? "failed"} | ${(entry.diagnostic ?? "").replaceAll("|", "\\|")} |`
    ),
    "",
    "## 差异产物",
    "",
    ...diffResults.map(
      (entry) =>
        `- ${entry.fixture}/${entry.renderer}: ${entry.status}${entry.diagnostic ? `（${entry.diagnostic}）` : ""}`
    ),
    "",
  ].join("\n")
  await fs.mkdir(path.join(artifactDir, "reports"), { recursive: true })
  await fs.writeFile(
    path.join(artifactDir, "reports", "design-report.json"),
    `${JSON.stringify(reportJson, null, 2)}\n`,
    "utf8"
  )
  await fs.writeFile(
    path.join(artifactDir, "reports", "design-report.md"),
    `${markdown}\n`,
    "utf8"
  )
  if (copyTo) {
    await fs.mkdir(copyTo, { recursive: true })
    await fs.cp(artifactDir, copyTo, { recursive: true, force: true })
  }
  return { summary, performance, diffs: diffResults, markdown, reportJson }
}

function parseArgs(argv) {
  const args = { artifactDir: path.resolve("des-0-artifacts") }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--artifact-dir")
      args.artifactDir = path.resolve(argv[++index])
    if (argv[index] === "--copy-to") args.copyTo = path.resolve(argv[++index])
  }
  return args
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const result = await generateReport(parseArgs(process.argv.slice(2)))
  console.log(
    JSON.stringify(
      { summary: result.summary, performance: result.performance },
      null,
      2
    )
  )
}

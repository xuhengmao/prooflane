import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultScenariosPath = path.join(moduleDir, "scenarios.json")

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function hashOperationSequence(operations) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(operations))
    .digest("hex")
}

function createNode(index, count) {
  const id = `node-${String(index).padStart(5, "0")}`
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count - 2))))
  const column = index % columns
  const row = Math.floor(index / columns)
  const x = 24 + (column % 12) * 96
  const y = 24 + (row % 8) * 78
  const bounds = { x, y, width: 84, height: 58 }
  const textSamples = [
    "Prooflane design fixture",
    "中文界面与项目协作",
    "Emoji status: ✅ 🚀",
    "עברית ו\u200fعربي bidirectional",
  ]
  const typeIndex = index % 6
  if (typeIndex === 0) {
    return {
      id,
      type: "frame",
      parentId: "page",
      bounds,
      style: { fill: index % 2 ? "#f3f5f8" : "#e9f4ff", stroke: "#ccd5e0" },
    }
  }
  if (typeIndex === 1) {
    return {
      id,
      type: "rectangle",
      parentId: "page",
      bounds,
      opacity: 0.96,
      style: { fill: index % 2 ? "#d8f3dc" : "#ffd6a5", radius: 8 },
    }
  }
  if (typeIndex === 2 || typeIndex === 3) {
    return {
      id,
      type: "text",
      parentId: "page",
      bounds,
      text: textSamples[index % textSamples.length],
      style: { fontSize: 14 + (index % 3) * 2, color: "#1f2937" },
    }
  }
  if (typeIndex === 4) {
    return {
      id,
      type: "image",
      parentId: "page",
      bounds,
      assetRef: `assets/images/fixture-${String(index % 8).padStart(2, "0")}.png`,
      metadata: { alt: "Deterministic fixture image" },
    }
  }
  return {
    id,
    type: "shape",
    parentId: "page",
    bounds,
    style: { fill: "#cde7ff", stroke: "#3b82f6", strokeWidth: 1 },
  }
}

export function createFixture(nodeCount, options = {}) {
  if (!Number.isInteger(nodeCount) || nodeCount < 3) {
    throw new RangeError(
      "nodeCount must be an integer greater than or equal to 3"
    )
  }
  const generated = Array.from({ length: nodeCount - 2 }, (_, offset) =>
    createNode(offset, nodeCount)
  )
  const childIds = generated.map((node) => node.id)
  const nodes = [
    { id: "document", type: "document", children: ["page"] },
    { id: "page", type: "page", parentId: "document", children: childIds },
    ...generated,
  ]
  const document = {
    version: 1,
    revision: `fixture-${nodeCount}-r1`,
    rootId: "document",
    nodes,
  }
  const operations = [
    { type: "select", nodeId: generated[0]?.id ?? "page" },
    { type: "pan", dx: 32, dy: -16 },
    { type: "zoom", factor: 1.25, origin: { x: 640, y: 400 } },
    {
      type: "select",
      nodeId: generated[Math.floor(generated.length / 2)]?.id ?? "page",
    },
    { type: "pan", dx: -12, dy: 20 },
    { type: "zoom", factor: 0.8, origin: { x: 320, y: 240 } },
  ]
  return {
    scenarioId: options.scenarioId ?? `nodes-${nodeCount}`,
    nodeCount,
    document,
    operations,
    operationSequenceHash: hashOperationSequence(operations),
    viewport: options.viewport ?? { width: 1280, height: 800, scale: 1 },
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    fonts: options.fonts ?? ["system-ui", "Noto Sans CJK SC", "Segoe UI Emoji"],
  }
}

async function loadScenarios(filePath = defaultScenariosPath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

export async function generateFixtures(
  outputDir,
  scenariosPath = defaultScenariosPath
) {
  const scenarios = await loadScenarios(scenariosPath)
  await fs.mkdir(outputDir, { recursive: true })
  const index = []
  for (const scenario of scenarios) {
    const fixture = createFixture(scenario.nodeCount, scenario)
    const outputPath = path.join(outputDir, `${scenario.id}.json`)
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(fixture, null, 2)}\n`,
      "utf8"
    )
    index.push({
      id: fixture.scenarioId,
      nodeCount: fixture.nodeCount,
      operationSequenceHash: fixture.operationSequenceHash,
      viewport: fixture.viewport,
      deviceScaleFactor: fixture.deviceScaleFactor,
      fonts: fixture.fonts,
      astFile: `${scenario.id}.json`,
    })
  }
  await fs.writeFile(
    path.join(outputDir, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  )
  return index
}

function parseArgs(argv) {
  const args = { output: path.resolve("des-0-artifacts/ast") }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") args.output = path.resolve(argv[++index])
    if (argv[index] === "--scenarios")
      args.scenarios = path.resolve(argv[++index])
  }
  return args
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const args = parseArgs(process.argv.slice(2))
  const result = await generateFixtures(args.output, args.scenarios)
  console.log(
    `Generated ${result.length} deterministic fixtures in ${args.output}`
  )
}

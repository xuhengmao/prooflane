import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const renderers = ["dom-svg", "canvaskit", "webgl"]

async function readFixtures(astDir) {
  const index = JSON.parse(
    await fs.readFile(path.join(astDir, "index.json"), "utf8")
  )
  return Promise.all(
    index.map(async (entry) => ({
      ...entry,
      data: JSON.parse(
        await fs.readFile(path.join(astDir, entry.astFile), "utf8")
      ),
    }))
  )
}

async function writeDiagnostic({ artifactDir, fixtures, diagnostic }) {
  const records = []
  for (const fixture of fixtures) {
    for (const renderer of renderers) {
      const rendererDir = path.join(artifactDir, "screenshots", renderer)
      await fs.mkdir(rendererDir, { recursive: true })
      const record = {
        fixture: fixture.id,
        renderer,
        nodeCount: fixture.nodeCount,
        operationSequenceHash: fixture.operationSequenceHash,
        status: "failed",
        diagnostic,
        screenshot: null,
      }
      records.push(record)
      await fs.writeFile(
        path.join(rendererDir, `${fixture.id}.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8"
      )
    }
  }
  await fs.mkdir(path.join(artifactDir, "performance"), { recursive: true })
  const result = { status: "failed", diagnostic, records }
  await fs.writeFile(
    path.join(artifactDir, "performance", "benchmark.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  )
  return result
}

async function pageState(page) {
  return page.evaluate(() => {
    const renderState = document
      .querySelector("main")
      ?.getAttribute("data-render-state")
    const diagnostic = document
      .querySelector('[role="status"]')
      ?.textContent?.trim()
    return {
      status:
        renderState === "completed"
          ? "passed"
          : renderState === "unavailable"
            ? "unavailable"
            : "failed",
      diagnostic: diagnostic || undefined,
    }
  })
}

export async function waitForTerminalRender(page, timeoutMs) {
  await page
    .locator(
      'main[data-render-state="completed"], main[data-render-state="unavailable"], main[data-render-state="failed"]'
    )
    .waitFor({ timeout: timeoutMs })
}

export async function runBenchmark({
  baseUrl,
  artifactDir = path.resolve("des-0-artifacts"),
  astDir = path.join(artifactDir, "ast"),
  timeoutMs = 30_000,
} = {}) {
  await fs.mkdir(artifactDir, { recursive: true })
  let fixtures
  try {
    fixtures = await readFixtures(astDir)
  } catch (error) {
    return writeDiagnostic({
      artifactDir,
      fixtures: [{ id: "unknown", nodeCount: 0 }],
      diagnostic: `fixture_read_failed: ${error.message}`,
    })
  }
  if (!baseUrl)
    return writeDiagnostic({
      artifactDir,
      fixtures,
      diagnostic:
        "base_url_required: 未提供 Design Lab 服务地址，请使用 --base-url http://127.0.0.1:3000",
    })
  let chromium
  try {
    ;({ chromium } = await import("@playwright/test"))
  } catch (error) {
    return writeDiagnostic({
      artifactDir,
      fixtures,
      diagnostic: `playwright_unavailable: ${error.message}`,
    })
  }
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    return writeDiagnostic({
      artifactDir,
      fixtures,
      diagnostic: `browser_launch_failed: ${error.message}`,
    })
  }
  const records = []
  try {
    for (const fixture of fixtures) {
      const viewport = fixture.data.viewport ?? {
        width: 1280,
        height: 800,
        scale: 1,
      }
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: fixture.data.deviceScaleFactor ?? 1,
      })
      const page = await context.newPage()
      for (const renderer of renderers) {
        const startedAt = performance.now()
        const rendererDir = path.join(artifactDir, "screenshots", renderer)
        await fs.mkdir(rendererDir, { recursive: true })
        const screenshotPath = path.join(rendererDir, `${fixture.id}.png`)
        let record
        try {
          const url = new URL("/__design-lab", baseUrl)
          url.searchParams.set("fixture", fixture.id)
          url.searchParams.set("renderer", renderer)
          await page.goto(url.toString(), {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs,
          })
          await page
            .locator('[data-testid="design-lab-canvas"]')
            .waitFor({ timeout: timeoutMs })
          await page
            .locator(`main[data-fixture-id="${fixture.id}"]`)
            .waitFor({ timeout: timeoutMs })
          await page
            .locator(`main[data-renderer-id="${renderer}"]`)
            .waitFor({ timeout: timeoutMs })
          await waitForTerminalRender(page, timeoutMs)
          const state = await pageState(page)
          await page.screenshot({
            path: screenshotPath,
            animations: "disabled",
          })
          record = {
            fixture: fixture.id,
            renderer,
            nodeCount: fixture.nodeCount,
            operationSequenceHash: fixture.operationSequenceHash,
            ...state,
            screenshot: path
              .relative(artifactDir, screenshotPath)
              .replaceAll("\\", "/"),
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            viewport,
          }
        } catch (error) {
          record = {
            fixture: fixture.id,
            renderer,
            nodeCount: fixture.nodeCount,
            operationSequenceHash: fixture.operationSequenceHash,
            status: "failed",
            diagnostic: `benchmark_failed: ${error.message}`,
            screenshot: null,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            viewport,
          }
        }
        await fs.writeFile(
          path.join(rendererDir, `${fixture.id}.json`),
          `${JSON.stringify(record, null, 2)}\n`,
          "utf8"
        )
        records.push(record)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
  const result = {
    status: records.some((entry) => entry.status === "failed")
      ? "failed"
      : "completed",
    generatedAt: new Date().toISOString(),
    records,
  }
  await fs.mkdir(path.join(artifactDir, "performance"), { recursive: true })
  await fs.writeFile(
    path.join(artifactDir, "performance", "benchmark.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  )
  return result
}

function parseArgs(argv) {
  const args = { artifactDir: path.resolve("des-0-artifacts") }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base-url") args.baseUrl = argv[++index]
    if (argv[index] === "--artifact-dir")
      args.artifactDir = path.resolve(argv[++index])
    if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index])
  }
  args.astDir = path.join(args.artifactDir, "ast")
  return args
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const result = await runBenchmark(parseArgs(process.argv.slice(2)))
  console.log(
    JSON.stringify(
      { status: result.status, diagnostic: result.diagnostic },
      null,
      2
    )
  )
  if (result.status === "failed") process.exitCode = 1
}

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export async function evaluateGoNoGo({
  artifactDir = path.resolve("des-0-artifacts"),
  licenseFile,
} = {}) {
  const blockers = []
  const reportPath = path.join(artifactDir, "reports", "design-report.json")
  let report
  try {
    report = JSON.parse(await fs.readFile(reportPath, "utf8"))
  } catch {
    blockers.push("missing_report")
  }
  if (report) {
    if (report.summary?.failed > 0) blockers.push("renderer_failed")
    if (report.summary?.unavailable > 0) blockers.push("renderer_unavailable")
    if (report.summary?.missing > 0) blockers.push("missing_artifacts")
    if (report.diffs?.some((entry) => entry.status !== "passed"))
      blockers.push("missing_or_failed_diffs")
    if (report.entries?.some((entry) => !entry.screenshot))
      blockers.push("missing_screenshots")
    if (!report.performance?.samples)
      blockers.push("missing_performance_samples")
  }
  const licensePath =
    licenseFile ?? path.join("docs", "design", "des-0-license-audit.json")
  try {
    const license = JSON.parse(await fs.readFile(licensePath, "utf8"))
    if (license.blocking) blockers.push("license_blocked")
  } catch {
    blockers.push("missing_license_audit")
  }
  return { decision: blockers.length ? "NO_GO" : "GO", blockers }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const artifactIndex = process.argv.indexOf("--artifact-dir")
  const artifactDir =
    artifactIndex >= 0
      ? path.resolve(process.argv[artifactIndex + 1])
      : undefined
  const result = await evaluateGoNoGo({ artifactDir })
  console.log(JSON.stringify(result, null, 2))
  if (result.decision === "NO_GO") process.exitCode = 1
}

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function auditLicenses({ rootDir = root, output } = {}) {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(rootDir, "package.json"), "utf8")
  )
  const dependencies = ["@playwright/test", "canvaskit-wasm"].map((name) => ({
    name,
    version:
      packageJson.devDependencies?.[name] ??
      packageJson.dependencies?.[name] ??
      null,
    source: "package.json",
    license: "需核对上游 LICENSE",
    status: "review_required",
    replacementCost: "中",
  }))
  const result = {
    generatedAt: new Date().toISOString(),
    dependencies,
    fonts: [
      {
        name: "system-ui/Noto Sans CJK SC/Segoe UI Emoji",
        source: "system",
        status: "allowed",
      },
    ],
    blocking: dependencies.some(
      (dependency) => dependency.status === "blocked"
    ),
  }
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  }
  return result
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const output = path.resolve("docs/design/des-0-license-audit.json")
  const result = await auditLicenses({ output })
  console.log(JSON.stringify(result, null, 2))
}

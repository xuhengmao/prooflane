import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export async function prepareWebAssets({ rootDir = process.cwd() } = {}) {
  const monacoSource = path.join(
    rootDir,
    "node_modules",
    "monaco-editor",
    "min",
    "vs"
  )
  const monacoTarget = path.join(rootDir, "public", "vs")
  await fs.cp(monacoSource, monacoTarget, { recursive: true, force: true })
  const loaderPath = path.join(monacoTarget, "loader.js")
  const loader = await fs.readFile(loaderPath, "utf8")
  await fs.writeFile(
    loaderPath,
    loader.replace(/^\/\/# sourceMappingURL=.*(?:\r?\n)?$/gm, ""),
    "utf8"
  )

  const canvasKitTarget = path.join(rootDir, "public", "canvaskit")
  await fs.mkdir(canvasKitTarget, { recursive: true })
  await fs.copyFile(
    path.join(rootDir, "node_modules", "canvaskit-wasm", "bin", "canvaskit.js"),
    path.join(canvasKitTarget, "canvaskit.js")
  )
  await fs.copyFile(
    path.join(
      rootDir,
      "node_modules",
      "canvaskit-wasm",
      "bin",
      "canvaskit.wasm"
    ),
    path.join(canvasKitTarget, "canvaskit.wasm")
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await prepareWebAssets()
}

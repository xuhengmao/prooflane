import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { prepareWebAssets } from "./prepare-web-assets.mjs"

test("安装时准备 Monaco 和本地 CanvasKit WASM 资源", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "prooflane-assets-"))
  await fs.mkdir(
    path.join(rootDir, "node_modules", "monaco-editor", "min", "vs"),
    { recursive: true }
  )
  await fs.mkdir(path.join(rootDir, "node_modules", "canvaskit-wasm", "bin"), {
    recursive: true,
  })
  await fs.writeFile(
    path.join(rootDir, "node_modules", "canvaskit-wasm", "bin", "canvaskit.js"),
    "globalThis.CanvasKitInit = () => {};"
  )
  await fs.writeFile(
    path.join(
      rootDir,
      "node_modules",
      "monaco-editor",
      "min",
      "vs",
      "loader.js"
    ),
    "loader();\n//# sourceMappingURL=loader.js.map\n"
  )
  await fs.writeFile(
    path.join(
      rootDir,
      "node_modules",
      "canvaskit-wasm",
      "bin",
      "canvaskit.wasm"
    ),
    "wasm-binary"
  )

  await prepareWebAssets({ rootDir })

  assert.equal(
    await fs.readFile(
      path.join(rootDir, "public", "canvaskit", "canvaskit.js"),
      "utf8"
    ),
    "globalThis.CanvasKitInit = () => {};"
  )
  assert.equal(
    await fs.readFile(path.join(rootDir, "public", "vs", "loader.js"), "utf8"),
    "loader();\n"
  )
  assert.equal(
    await fs.readFile(
      path.join(rootDir, "public", "canvaskit", "canvaskit.wasm"),
      "utf8"
    ),
    "wasm-binary"
  )
})

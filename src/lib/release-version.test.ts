import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

const root = process.cwd()
const releaseVersion = "0.24.1-rc.1"

describe("release version", () => {
  test("keeps npm, Cargo, and Tauri manifests aligned", () => {
    const packageManifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8")
    ) as { version: string }
    const tauriManifest = JSON.parse(
      readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")
    ) as { version: string }
    const cargoManifest = readFileSync(
      path.join(root, "src-tauri/Cargo.toml"),
      "utf8"
    )
    const cargoLock = readFileSync(
      path.join(root, "src-tauri/Cargo.lock"),
      "utf8"
    )
    const escapedReleaseVersion = releaseVersion.replaceAll(".", "\\.")

    expect(packageManifest.version).toBe(releaseVersion)
    expect(tauriManifest.version).toBe(releaseVersion)
    expect(cargoManifest).toMatch(
      new RegExp(`^version = "${escapedReleaseVersion}"$`, "m")
    )
    expect(cargoLock).toMatch(
      new RegExp(
        `\\[\\[package\\]\\]\\r?\\nname = "prooflane"\\r?\\nversion = "${escapedReleaseVersion}"`
      )
    )
  })
})

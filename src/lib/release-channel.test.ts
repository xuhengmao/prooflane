import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { afterEach, describe, expect, test } from "vitest"

const root = process.cwd()
const script = path.join(root, "scripts/resolve-release-channel.mjs")
const temporaryDirectories: string[] = []

function resolveChannel(tag: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prooflane-release-"))
  temporaryDirectories.push(directory)
  const output = path.join(directory, "github-output.txt")
  const result = spawnSync(process.execPath, [script, tag], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
  })

  return {
    ...result,
    output: existsSync(output) ? readFileSync(output, "utf8") : "",
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("release channel resolution", () => {
  test("classifies a stable SemVer tag", () => {
    const result = resolveChannel("v0.24.1")

    expect(result.status).toBe(0)
    expect(result.output).toContain("prerelease=false")
  })

  test("classifies an rc.N SemVer tag as prerelease", () => {
    const result = resolveChannel("v0.24.1-rc.1")

    expect(result.status).toBe(0)
    expect(result.output).toContain("prerelease=true")
  })

  test.each([
    "v0.24.1-alpha.1",
    "v0.24.1+build-rc",
    "v0.24.1-rc",
    "v0.24.1-rc.01",
    "v01.24.1",
  ])("rejects unsupported release tag %s", (tag) => {
    const result = resolveChannel(tag)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unsupported release tag")
    expect(result.output).toBe("")
  })
})

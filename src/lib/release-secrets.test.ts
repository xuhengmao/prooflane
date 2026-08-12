import { spawnSync } from "node:child_process"
import path from "node:path"

import { describe, expect, test } from "vitest"

const root = process.cwd()
const script = path.join(root, "scripts/validate-release-secrets.mjs")
const requiredSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
] as const

function completeEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  for (const name of requiredSecrets) {
    environment[name] = `configured-${name.toLowerCase()}`
  }
  return environment
}

function runValidator(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  })
}

describe("release secret validation", () => {
  test("accepts a fully configured release environment", () => {
    const result = runValidator(completeEnvironment())

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Release signing secrets are configured")
  })

  test.each(requiredSecrets)("fails closed when %s is missing", (missing) => {
    const environment = completeEnvironment()
    delete environment[missing]

    const result = runValidator(environment)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(missing)
    expect(result.stderr).not.toContain(`configured-${missing.toLowerCase()}`)
  })
})

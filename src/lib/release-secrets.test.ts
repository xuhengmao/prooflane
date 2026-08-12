import { spawnSync } from "node:child_process"
import path from "node:path"

import { describe, expect, test } from "vitest"

const root = process.cwd()
const script = path.join(root, "scripts/validate-release-secrets.mjs")
const requiredSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
] as const
const appleSecrets = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
] as const

function completeEnvironment(prerelease = false): NodeJS.ProcessEnv {
  const environment = {
    ...process.env,
    RELEASE_PRERELEASE: String(prerelease),
  }
  for (const name of [...requiredSecrets, ...appleSecrets]) {
    environment[name] = `configured-${name.toLowerCase()}`
  }
  return environment
}

function withoutAppleSecrets(environment: NodeJS.ProcessEnv) {
  for (const name of appleSecrets) {
    delete environment[name]
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

  test.each([...requiredSecrets, ...appleSecrets])(
    "fails closed for a stable release when %s is missing",
    (missing) => {
      const environment = completeEnvironment()
      delete environment[missing]

      const result = runValidator(environment)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(missing)
      expect(result.stderr).not.toContain(`configured-${missing.toLowerCase()}`)
    }
  )

  test("accepts a prerelease without Apple signing credentials", () => {
    const result = runValidator(withoutAppleSecrets(completeEnvironment(true)))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Apple signing is disabled")
  })

  test.each(requiredSecrets)(
    "requires %s for prerelease updater signing",
    (missing) => {
      const environment = withoutAppleSecrets(completeEnvironment(true))
      delete environment[missing]

      const result = runValidator(environment)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(missing)
    }
  )

  test.each(appleSecrets)(
    "rejects partially configured Apple signing when %s is missing",
    (missing) => {
      const environment = completeEnvironment(true)
      delete environment[missing]

      const result = runValidator(environment)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(missing)
    }
  )
})

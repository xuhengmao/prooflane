import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

const workflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/release.yml"),
  "utf8"
)

describe("release candidate signing policy", () => {
  test("resolves the channel with the fail-closed tag parser", () => {
    expect(workflow).toContain(
      'node scripts/resolve-release-channel.mjs "$GITHUB_REF_NAME"'
    )
    expect(workflow).not.toContain('== *"-rc"*')
  })

  test("passes the prerelease channel to secret validation", () => {
    expect(workflow).toContain(
      "RELEASE_PRERELEASE: ${{ steps.meta.outputs.prerelease }}"
    )
  })

  test("exports the Apple signing decision to release builds", () => {
    expect(workflow).toContain(
      "apple_signing_enabled: ${{ steps.signing.outputs.apple_signing_enabled }}"
    )
  })

  test.each([
    "Import Apple Developer ID certificate",
    "Resolve Apple Developer ID identity",
  ])("only runs %s when Apple signing is enabled", (stepName) => {
    const stepStart = workflow.indexOf(`- name: ${stepName}`)
    const nextStep = workflow.indexOf("\n      - name:", stepStart + 1)
    const step = workflow.slice(stepStart, nextStep)

    expect(stepStart).toBeGreaterThan(-1)
    expect(step).toContain(
      "needs.create-draft-release.outputs.apple_signing_enabled == 'true'"
    )
  })

  test("does not move the latest container tag for a prerelease", () => {
    expect(workflow).toContain(
      "needs.create-draft-release.outputs.prerelease == 'false' && format('ghcr.io/{0}:latest', github.repository) || ''"
    )
  })
})

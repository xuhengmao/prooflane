import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

const workflow = readFileSync(
  path.join(process.cwd(), ".github/workflows/test.yml"),
  "utf8"
)

describe("Rust CI resource limits", () => {
  test("keeps desktop test artifacts within the hosted runner disk budget", () => {
    expect(workflow).toContain('CARGO_PROFILE_DEV_DEBUG: "0"')
    expect(workflow).toContain('CARGO_PROFILE_TEST_DEBUG: "0"')
    expect(workflow).toContain(
      "shared-key: test-v2-${{ matrix.os }}-${{ matrix.mode }}"
    )
    expect(workflow).toContain(
      "cache-targets: ${{ matrix.os != 'ubuntu-22.04' || matrix.mode != 'desktop' }}"
    )
  })
})

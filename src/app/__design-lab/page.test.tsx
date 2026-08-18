import { describe, expect, it } from "vitest"
import DesignLabPage from "./page"

describe("Design Lab route", () => {
  it("exports the development harness page", () => {
    expect(typeof DesignLabPage).toBe("function")
  })
})

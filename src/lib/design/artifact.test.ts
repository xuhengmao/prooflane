import { describe, expect, it } from "vitest"

import {
  filterAndSortDesignArtifacts,
  type DesignArtifact,
  type DesignArtifactFilters,
} from "./artifact"

const ALL_FILTERS: DesignArtifactFilters = {
  query: "",
  kinds: [],
  statuses: [],
  project: "all",
}

function artifact(
  overrides: Partial<DesignArtifact> & Pick<DesignArtifact, "id" | "name">
): DesignArtifact {
  return {
    id: overrides.id,
    name: overrides.name,
    kind: "page",
    status: "draft",
    currentRevisionId: `revision-${overrides.id}`,
    projectFolderId: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  }
}

describe("filterAndSortDesignArtifacts", () => {
  it("never exposes soft-deleted artifacts", () => {
    const visible = artifact({ id: "visible", name: "控制台" })
    const deleted = artifact({
      id: "deleted",
      name: "已删除控制台",
      deletedAt: "2026-08-19T02:00:00.000Z",
    })

    expect(
      filterAndSortDesignArtifacts([deleted, visible], ALL_FILTERS).map(
        (item) => item.id
      )
    ).toEqual(["visible"])
  })

  it("matches names without English letter-case sensitivity", () => {
    const artifacts = [
      artifact({ id: "dashboard", name: "Sales Dashboard 销售看板" }),
      artifact({ id: "profile", name: "用户资料" }),
    ]

    expect(
      filterAndSortDesignArtifacts(artifacts, {
        ...ALL_FILTERS,
        query: "  DASHBOARD 销售  ",
      }).map((item) => item.id)
    ).toEqual(["dashboard"])
  })

  it("combines kind, status, and project filters", () => {
    const artifacts = [
      artifact({
        id: "match",
        name: "组件库",
        kind: "design_system",
        status: "active",
        projectFolderId: 7,
      }),
      artifact({
        id: "wrong-kind",
        name: "页面",
        kind: "page",
        status: "active",
        projectFolderId: 7,
      }),
      artifact({
        id: "wrong-status",
        name: "旧组件库",
        kind: "design_system",
        status: "archived",
        projectFolderId: 7,
      }),
      artifact({
        id: "unlinked",
        name: "独立组件库",
        kind: "design_system",
        status: "active",
      }),
    ]

    expect(
      filterAndSortDesignArtifacts(artifacts, {
        query: "",
        kinds: ["design_system"],
        statuses: ["active"],
        project: "linked",
      }).map((item) => item.id)
    ).toEqual(["match"])
  })

  it("sorts by newest update and uses id as a stable tie-breaker", () => {
    const artifacts = [
      artifact({
        id: "zeta",
        name: "Zeta",
        updatedAt: "2026-08-19T02:00:00.000Z",
      }),
      artifact({
        id: "newest",
        name: "Newest",
        updatedAt: "2026-08-19T03:00:00.000Z",
      }),
      artifact({
        id: "alpha",
        name: "Alpha",
        updatedAt: "2026-08-19T02:00:00.000Z",
      }),
    ]

    expect(
      filterAndSortDesignArtifacts(artifacts, ALL_FILTERS).map(
        (item) => item.id
      )
    ).toEqual(["newest", "alpha", "zeta"])
  })
})

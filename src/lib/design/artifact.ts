export type DesignArtifactKind =
  | "page"
  | "component"
  | "image"
  | "icon"
  | "design_system"
  | "flow"

export type DesignArtifactStatus = "draft" | "active" | "archived"

export interface DesignArtifact {
  id: string
  name: string
  kind: DesignArtifactKind
  status: DesignArtifactStatus
  currentRevisionId: string
  projectFolderId: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface DesignArtifactFilters {
  query: string
  kinds: DesignArtifactKind[]
  statuses: DesignArtifactStatus[]
  project: "all" | "linked" | "unlinked"
}

function matchesProjectFilter(
  artifact: DesignArtifact,
  project: DesignArtifactFilters["project"]
): boolean {
  if (project === "linked") return artifact.projectFolderId !== null
  if (project === "unlinked") return artifact.projectFolderId === null
  return true
}

export function filterAndSortDesignArtifacts(
  artifacts: readonly DesignArtifact[],
  filters: DesignArtifactFilters
): DesignArtifact[] {
  const queryTerms = filters.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return artifacts
    .filter((artifact) => {
      if (artifact.deletedAt !== null) return false

      const normalizedName = artifact.name.toLocaleLowerCase()
      if (!queryTerms.every((term) => normalizedName.includes(term))) {
        return false
      }
      if (filters.kinds.length > 0 && !filters.kinds.includes(artifact.kind)) {
        return false
      }
      if (
        filters.statuses.length > 0 &&
        !filters.statuses.includes(artifact.status)
      ) {
        return false
      }
      return matchesProjectFilter(artifact, filters.project)
    })
    .sort((left, right) => {
      const updatedOrder =
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      if (updatedOrder !== 0) return updatedOrder
      if (left.id < right.id) return -1
      if (left.id > right.id) return 1
      return 0
    })
}

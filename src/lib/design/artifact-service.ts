import { invoke as tauriInvoke } from "@tauri-apps/api/core"

import type { DesignArtifact, DesignArtifactKind } from "./artifact"

export interface DesignArtifactDetail {
  artifact: DesignArtifact
  revision: {
    id: string
    artifactId: string
    parentRevisionId: string | null
    revisionNumber: number
    schemaVersion: number
    document: Record<string, unknown>
    createdAt: string
  }
}

export interface CreateDesignArtifactInput {
  name: string
  kind: DesignArtifactKind
  projectFolderId: number | null
  document: Record<string, unknown>
}

export interface SaveDesignRevisionInput {
  artifactId: string
  expectedRevisionId: string
  schemaVersion: number
  document: Record<string, unknown>
}

export type DesignInvoke = typeof tauriInvoke

export function listDesignArtifacts(
  invoke: DesignInvoke = tauriInvoke,
  includeArchived = false
): Promise<DesignArtifact[]> {
  return invoke("list_design_artifacts", { includeArchived })
}

export function getDesignArtifact(
  invoke: DesignInvoke = tauriInvoke,
  id: string
): Promise<DesignArtifactDetail> {
  return invoke("get_design_artifact", { id })
}

export function createDesignArtifact(
  invoke: DesignInvoke = tauriInvoke,
  input: CreateDesignArtifactInput
): Promise<DesignArtifact> {
  return invoke("create_design_artifact", { input })
}

export function renameDesignArtifact(
  invoke: DesignInvoke = tauriInvoke,
  id: string,
  name: string
): Promise<DesignArtifact> {
  return invoke("rename_design_artifact", { id, name })
}

export function duplicateDesignArtifact(
  invoke: DesignInvoke = tauriInvoke,
  id: string
): Promise<DesignArtifact> {
  return invoke("duplicate_design_artifact", { id })
}

export function setDesignArtifactArchived(
  invoke: DesignInvoke = tauriInvoke,
  id: string,
  archived: boolean
): Promise<DesignArtifact> {
  return invoke("set_design_artifact_archived", { id, archived })
}

export function deleteDesignArtifact(
  invoke: DesignInvoke = tauriInvoke,
  id: string
): Promise<void> {
  return invoke("delete_design_artifact", { id })
}

export function saveDesignRevision(
  invoke: DesignInvoke = tauriInvoke,
  input: SaveDesignRevisionInput
): Promise<DesignArtifactDetail> {
  return invoke("save_design_revision", { input })
}

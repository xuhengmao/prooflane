import type { DesignDocument } from "../ast"
import type { ChangeSet, ChangeSetInput } from "../changeset"

export interface AIChangeSet extends ChangeSet {
  intent: string
  targetNodeIds: string[]
  affectedDependencies: string[]
  preview: string
  riskLevel: "low" | "medium" | "high"
  provider: string
  createdAt: string
}

export interface GenerateChangeSetInput {
  fixtureId: string
  document: DesignDocument
  prompt: string
  scenario?: "success" | "invalid" | "revision-conflict" | "failure"
}

export interface DesignAiProvider {
  generateChangeSet(input: GenerateChangeSetInput): Promise<AIChangeSet>
}

export type ChangeSetInputFactory = Omit<AIChangeSet, keyof ChangeSetInput>

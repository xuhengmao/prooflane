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
  context?: unknown
  scenario?: "success" | "invalid" | "revision-conflict" | "failure"
}

export interface DesignAiProvider {
  generateChangeSet(input: GenerateChangeSetInput): Promise<AIChangeSet>
}

export type ChangeSetInputFactory = Omit<AIChangeSet, keyof ChangeSetInput>

const SENSITIVE_CONTEXT_PATTERN =
  /\b(?:credential|credentials|password|passwd|secret|token|api[\s_-]*key|access[\s_-]*key|authorization)\b|凭据|密码|口令|令牌/i

/** Reject potentially sensitive context before it can reach an AI provider. */
export function assertSafeContext(context: unknown): void {
  if (context === undefined || context === null) return
  let serialized: string
  try {
    serialized = typeof context === "string" ? context : JSON.stringify(context)
  } catch {
    throw new Error("sensitive_context_rejected")
  }
  if (SENSITIVE_CONTEXT_PATTERN.test(serialized ?? ""))
    throw new Error("sensitive_context_rejected")
}

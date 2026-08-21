import { createChangeSet } from "../changeset"
import type { Command } from "../commands"
import type {
  AIChangeSet,
  DesignAiProvider,
  GenerateChangeSetInput,
} from "./provider"
import { assertSafeContext } from "./provider"
import { validateChangeSetShape } from "./changeset-guard"

export class MockDesignAiProvider implements DesignAiProvider {
  async generateChangeSet(input: GenerateChangeSetInput): Promise<AIChangeSet> {
    assertSafeContext(input.context)
    if (input.scenario === "failure") throw new Error("mock_provider_failure")
    const title = input.document.nodes.find((node) => node.type === "text")
    const operations: Command[] =
      input.scenario === "invalid"
        ? [{ type: "SetText", id: "missing-node", text: input.prompt }]
        : [
            {
              type: "SetText",
              id: title?.id ?? "missing-node",
              text: input.prompt || "Mock title",
            },
          ]
    const baseRevision =
      input.scenario === "revision-conflict"
        ? "stale-revision"
        : input.document.revision
    const changeSet = createChangeSet({
      id: `mock-${input.fixtureId}`,
      baseRevision,
      operations,
    })
    const result: AIChangeSet = {
      ...changeSet,
      intent: "Update the fixture title from the prompt",
      targetNodeIds: operations.flatMap((operation) =>
        "id" in operation ? [operation.id] : [operation.node.id]
      ),
      affectedDependencies: [],
      preview: "将标题替换为用户输入文本",
      riskLevel: "low",
      provider: "deterministic-mock",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const shape = validateChangeSetShape(result)
    if (!shape.ok) throw new Error(shape.errors[0])
    return result
  }
}

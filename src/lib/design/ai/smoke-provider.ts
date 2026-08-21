import type {
  AIChangeSet,
  DesignAiProvider,
  GenerateChangeSetInput,
} from "./provider"
import { assertSafeContext } from "./provider"
import { validateChangeSet, validateChangeSetShape } from "./changeset-guard"

export interface RealModelSmokeTransport {
  request(input: GenerateChangeSetInput): Promise<unknown>
}

/** Explicit opt-in seam for real-model smoke tests; production code never creates it implicitly. */
export class OptInRealModelSmokeProvider implements DesignAiProvider {
  constructor(private readonly transport?: RealModelSmokeTransport) {}

  async generateChangeSet(input: GenerateChangeSetInput): Promise<AIChangeSet> {
    if (!this.transport) throw new Error("real_model_smoke_opt_in_required")
    assertSafeContext(input.context)
    const result = await this.transport.request(input)
    const shape = validateChangeSetShape(result)
    if (!shape.ok) throw new Error(shape.errors[0])
    const guard = validateChangeSet(result as AIChangeSet, input.document)
    if (!guard.ok) throw new Error(guard.errors[0])
    return result as AIChangeSet
  }
}

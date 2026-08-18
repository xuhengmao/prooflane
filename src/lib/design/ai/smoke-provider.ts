import type {
  AIChangeSet,
  DesignAiProvider,
  GenerateChangeSetInput,
} from "./provider"

export interface RealModelSmokeTransport {
  request(input: GenerateChangeSetInput): Promise<unknown>
}

/** Explicit opt-in seam for real-model smoke tests; production code never creates it implicitly. */
export class OptInRealModelSmokeProvider implements DesignAiProvider {
  constructor(private readonly transport?: RealModelSmokeTransport) {}

  async generateChangeSet(input: GenerateChangeSetInput): Promise<AIChangeSet> {
    if (!this.transport) throw new Error("real_model_smoke_opt_in_required")
    const result = await this.transport.request(input)
    if (!result || typeof result !== "object")
      throw new Error("real_model_smoke_invalid_response")
    return result as AIChangeSet
  }
}

import type { LiveMessage } from "@/contexts/acp-connections-context"

export type LiveTokenRateSource = "provider" | "estimated"

export interface ProviderOutputTokenSample {
  runId: string
  outputTokens: number
}

export interface LiveTokenRateSnapshot {
  tokensPerSecond: number | null
  source: LiveTokenRateSource
}

export interface LiveTokenRateInput {
  active: boolean
  runId: string | null
  visibleText: string
  providerSample?: ProviderOutputTokenSample | null
  now: number
}

interface TokenSample {
  now: number
  tokens: number
}

const WINDOW_MS = 3_000
const PUBLISH_THROTTLE_MS = 500

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isWhitespace(codePoint: number): boolean {
  return /\s/u.test(String.fromCodePoint(codePoint))
}

function isDirectlyCountedCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x3040 && codePoint <= 0x309f) ||
    (codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  )
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

function buildSnapshot(
  tokensPerSecond: number | null,
  source: LiveTokenRateSource
): LiveTokenRateSnapshot {
  return { tokensPerSecond, source }
}

function tokensFromText(text: string): number {
  let cjk = 0
  let other = 0

  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined || isWhitespace(codePoint)) continue
    if (isDirectlyCountedCjk(codePoint)) {
      cjk += 1
    } else {
      other += 1
    }
  }

  return cjk + Math.ceil(other / 4)
}

function hasReadableProviderSample(
  input: LiveTokenRateInput
): input is LiveTokenRateInput & {
  providerSample: ProviderOutputTokenSample
} {
  const sample = input.providerSample
  if (!input.active || !input.runId || !sample) return false
  if (sample.runId !== input.runId) return false
  if (!isFiniteNumber(sample.outputTokens)) return false
  if (sample.outputTokens < 0) return false
  return true
}

export function extractVisibleAssistantText(
  message: LiveMessage | null
): string {
  if (!message || message.role !== "assistant") return ""

  let text = ""
  for (const block of message.content) {
    if (block.type === "text") text += block.text
  }
  return text
}

export function estimateVisibleTokens(text: string): number {
  return tokensFromText(text)
}

export class LiveTokenRateSampler {
  private runId: string | null = null
  private samples: TokenSample[] = []
  private lastVisibleTokens = 0
  private lastObservedAt = Number.NEGATIVE_INFINITY
  private lastPublishedAt: number | null = null
  private lastPublishedSnapshot: LiveTokenRateSnapshot = buildSnapshot(
    null,
    "estimated"
  )
  private lastProviderTokens: number | null = null

  reset(): void {
    this.runId = null
    this.samples = []
    this.lastVisibleTokens = 0
    this.lastObservedAt = Number.NEGATIVE_INFINITY
    this.lastPublishedAt = null
    this.lastPublishedSnapshot = buildSnapshot(null, "estimated")
    this.lastProviderTokens = null
  }

  update(input: LiveTokenRateInput): LiveTokenRateSnapshot {
    const visibleTokens = estimateVisibleTokens(input.visibleText)
    const providerIsReadable = hasReadableProviderSample(input)
    const providerRolledBack =
      providerIsReadable &&
      this.runId === input.runId &&
      this.lastProviderTokens !== null &&
      input.providerSample.outputTokens < this.lastProviderTokens
    const providerIsValid = providerIsReadable && !providerRolledBack
    const source: LiveTokenRateSource = providerIsValid
      ? "provider"
      : "estimated"

    if (!input.active || !input.runId || !Number.isFinite(input.now)) {
      this.reset()
      return buildSnapshot(null, source)
    }

    const runChanged = this.runId !== null && this.runId !== input.runId
    const timeRolledBack = input.now < this.lastObservedAt
    const gapExceeded =
      this.lastObservedAt !== Number.NEGATIVE_INFINITY &&
      input.now - this.lastObservedAt > WINDOW_MS
    const textShrank = visibleTokens < this.lastVisibleTokens

    if (
      runChanged ||
      timeRolledBack ||
      gapExceeded ||
      textShrank ||
      providerRolledBack
    ) {
      this.reset()
    }

    const sampleTokens = providerIsValid
      ? input.providerSample.outputTokens
      : visibleTokens
    const sampleSource: LiveTokenRateSource = providerIsValid
      ? "provider"
      : "estimated"

    this.runId = input.runId
    this.lastVisibleTokens = visibleTokens
    this.lastObservedAt = input.now
    this.samples.push({ now: input.now, tokens: sampleTokens })
    this.pruneSamples(input.now)

    if (providerIsValid) {
      this.lastProviderTokens = input.providerSample.outputTokens
    }

    const snapshot = this.computeSnapshot(sampleSource)
    if (snapshot.tokensPerSecond === null) {
      return snapshot
    }

    if (
      this.lastPublishedAt !== null &&
      input.now - this.lastPublishedAt < PUBLISH_THROTTLE_MS
    ) {
      return this.lastPublishedSnapshot
    }

    this.lastPublishedAt = input.now
    this.lastPublishedSnapshot = snapshot
    return snapshot
  }

  private pruneSamples(now: number): void {
    const cutoff = now - WINDOW_MS
    this.samples = this.samples.filter((sample) => sample.now >= cutoff)
  }

  private computeSnapshot(source: LiveTokenRateSource): LiveTokenRateSnapshot {
    if (this.samples.length < 2) {
      return buildSnapshot(null, source)
    }

    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const deltaTokens = last.tokens - first.tokens
    const deltaSeconds = (last.now - first.now) / 1000

    if (deltaSeconds <= 0 || !Number.isFinite(deltaSeconds)) {
      return buildSnapshot(null, source)
    }

    const tokensPerSecond = clampNonNegative(
      Math.round(deltaTokens / deltaSeconds)
    )
    return buildSnapshot(tokensPerSecond, source)
  }
}

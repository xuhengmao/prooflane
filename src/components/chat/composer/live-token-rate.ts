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
const HAN_SCRIPT = /^\p{Script=Han}$/u
const HIRAGANA_SCRIPT = /^\p{Script=Hiragana}$/u
const KATAKANA_SCRIPT = /^\p{Script=Katakana}$/u
const HANGUL_SCRIPT = /^\p{Script=Hangul}$/u

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isWhitespace(codePoint: number): boolean {
  return /\s/u.test(String.fromCodePoint(codePoint))
}

function isDirectlyCountedScript(char: string): boolean {
  return (
    HAN_SCRIPT.test(char) ||
    HIRAGANA_SCRIPT.test(char) ||
    KATAKANA_SCRIPT.test(char) ||
    HANGUL_SCRIPT.test(char)
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
    if (isDirectlyCountedScript(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }

  return cjk + Math.ceil(other / 4)
}

function visibleTextLength(text: string): number {
  return Array.from(text).length
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
  private lastVisibleTextLength = 0
  private lastObservedAt = Number.NEGATIVE_INFINITY
  private lastPublishedAt: number | null = null
  private lastPublishedSnapshot: LiveTokenRateSnapshot = buildSnapshot(
    null,
    "estimated"
  )
  private lastProviderTokens: number | null = null
  private currentSource: LiveTokenRateSource | null = null

  reset(): void {
    this.runId = null
    this.samples = []
    this.lastVisibleTokens = 0
    this.lastVisibleTextLength = 0
    this.lastObservedAt = Number.NEGATIVE_INFINITY
    this.lastPublishedAt = null
    this.lastPublishedSnapshot = buildSnapshot(null, "estimated")
    this.lastProviderTokens = null
    this.currentSource = null
  }

  update(input: LiveTokenRateInput): LiveTokenRateSnapshot {
    const visibleTokens = estimateVisibleTokens(input.visibleText)
    const visibleLength = visibleTextLength(input.visibleText)
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
      return buildSnapshot(null, "estimated")
    }

    const runChanged = this.runId !== null && this.runId !== input.runId
    const timeRolledBack = input.now < this.lastObservedAt
    const gapExceeded =
      this.lastObservedAt !== Number.NEGATIVE_INFINITY &&
      input.now - this.lastObservedAt > WINDOW_MS
    const sourceChanged =
      this.currentSource !== null && this.currentSource !== source
    const textShrank = visibleLength < this.lastVisibleTextLength

    if (
      runChanged ||
      timeRolledBack ||
      gapExceeded ||
      textShrank ||
      providerRolledBack ||
      sourceChanged
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
    this.lastVisibleTextLength = visibleLength
    this.lastObservedAt = input.now
    this.currentSource = sampleSource
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

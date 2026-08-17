"use client"

import { useEffect, useRef, useState } from "react"

import type { LiveMessage } from "@/contexts/acp-connections-context"

import {
  LiveTokenRateSampler,
  type LiveTokenRateSnapshot,
  type ProviderOutputTokenSample,
  extractVisibleAssistantText,
} from "./live-token-rate"

export interface UseLiveTokenRateInput {
  active: boolean
  liveMessage: LiveMessage | null
  providerSample?: ProviderOutputTokenSample | null
}

const POLL_INTERVAL_MS = 500
const EMPTY_SNAPSHOT: LiveTokenRateSnapshot = {
  tokensPerSecond: null,
  source: "estimated",
}

function isAssistantLiveMessage(
  liveMessage: LiveMessage | null
): liveMessage is LiveMessage {
  return liveMessage?.role === "assistant"
}

function buildRunId(liveMessage: LiveMessage | null): string | null {
  if (!isAssistantLiveMessage(liveMessage)) return null
  return `${liveMessage.id}:${liveMessage.startedAt}`
}

function sameSnapshot(
  a: LiveTokenRateSnapshot,
  b: LiveTokenRateSnapshot
): boolean {
  return a.tokensPerSecond === b.tokensPerSecond && a.source === b.source
}

export function useLiveTokenRate(
  input: UseLiveTokenRateInput
): LiveTokenRateSnapshot {
  const samplerRef = useRef<LiveTokenRateSampler | null>(null)
  if (samplerRef.current === null) {
    samplerRef.current = new LiveTokenRateSampler()
  }

  const [snapshot, setSnapshot] =
    useState<LiveTokenRateSnapshot>(EMPTY_SNAPSHOT)
  const runId = buildRunId(input.liveMessage)
  const visibleText = extractVisibleAssistantText(input.liveMessage)

  useEffect(() => {
    const sampler = samplerRef.current
    if (sampler === null) return

    if (!input.active || runId === null) {
      sampler.reset()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 运行结束时必须同一轮渲染清空旧速度，避免复用残留快照。
      setSnapshot(EMPTY_SNAPSHOT)
      return
    }

    const publish = (): void => {
      const next = sampler.update({
        active: input.active,
        runId,
        visibleText,
        providerSample: input.providerSample,
        now: Date.now(),
      })

      setSnapshot((current) => (sameSnapshot(current, next) ? current : next))
    }

    publish()
    const interval = window.setInterval(publish, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [input.active, input.providerSample, runId, visibleText])

  return snapshot
}

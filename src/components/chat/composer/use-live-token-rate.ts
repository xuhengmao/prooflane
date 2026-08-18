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

interface PublishedSnapshot {
  runId: string | null
  snapshot: LiveTokenRateSnapshot
}

const EMPTY_PUBLISHED_SNAPSHOT: PublishedSnapshot = {
  runId: null,
  snapshot: EMPTY_SNAPSHOT,
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

  const [snapshot, setSnapshot] = useState<PublishedSnapshot>(
    EMPTY_PUBLISHED_SNAPSHOT
  )
  const runId = buildRunId(input.liveMessage)
  const visibleText = extractVisibleAssistantText(input.liveMessage)
  const displaySnapshot =
    input.active && runId !== null && snapshot.runId === runId
      ? snapshot.snapshot
      : EMPTY_SNAPSHOT

  useEffect(() => {
    const sampler = samplerRef.current
    if (sampler === null) return

    if (!input.active || runId === null) {
      sampler.reset()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- render 已同步返回空快照；这里清状态 key，避免同一 run 再激活时复用旧速度。
      setSnapshot((current) =>
        current.runId === null && sameSnapshot(current.snapshot, EMPTY_SNAPSHOT)
          ? current
          : EMPTY_PUBLISHED_SNAPSHOT
      )
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

      setSnapshot((current) =>
        current.runId === runId && sameSnapshot(current.snapshot, next)
          ? current
          : { runId, snapshot: next }
      )
    }

    publish()
    const interval = window.setInterval(publish, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [input.active, input.providerSample, runId, visibleText])

  return displaySnapshot
}

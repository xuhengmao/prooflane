import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import type { LiveTokenRateSnapshot } from "./live-token-rate"
import { useLiveTokenRate } from "./use-live-token-rate"

function makeLiveMessage(
  id: string,
  startedAt: number,
  text: string
): LiveMessage {
  return {
    id,
    role: "assistant",
    startedAt,
    content: [{ type: "text", text }],
  }
}

const EMPTY_SNAPSHOT: LiveTokenRateSnapshot = {
  tokensPerSecond: null,
  source: "estimated",
}

describe("useLiveTokenRate", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("publishes an estimated rate after 500ms, keeps the same run window, and blanks immediately when the run identity changes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const initial = makeLiveMessage("m1", 100, "abcd")
    const snapshots: LiveTokenRateSnapshot[] = []
    const { result, rerender } = renderHook(
      ({ active, liveMessage }) => {
        const snapshot = useLiveTokenRate({ active, liveMessage })
        snapshots.push(snapshot)
        return snapshot
      },
      {
        initialProps: {
          active: true,
          liveMessage: initial,
        },
      }
    )

    expect(result.current).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })

    act(() => {
      vi.setSystemTime(500)
    })
    rerender({
      active: true,
      liveMessage: makeLiveMessage("m1", 100, "abcdefgh"),
    })

    expect(result.current).toEqual({
      tokensPerSecond: 2,
      source: "estimated",
    })

    act(() => {
      vi.setSystemTime(1000)
    })
    rerender({
      active: true,
      liveMessage: makeLiveMessage("m1", 100, "abcdefghijkl"),
    })

    expect(result.current).toEqual({
      tokensPerSecond: 2,
      source: "estimated",
    })

    snapshots.length = 0
    rerender({
      active: true,
      liveMessage: makeLiveMessage("m2", 200, "abcdefgh"),
    })

    expect(snapshots[0]).toEqual(EMPTY_SNAPSHOT)
    expect(result.current).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })
  })

  it("clears immediately when inactive and does not leak its interval on unmount", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const snapshots: LiveTokenRateSnapshot[] = []
    const { result, rerender, unmount } = renderHook(
      ({ active, liveMessage }) => {
        const snapshot = useLiveTokenRate({ active, liveMessage })
        snapshots.push(snapshot)
        return snapshot
      },
      {
        initialProps: {
          active: true,
          liveMessage: makeLiveMessage("m1", 100, "abcd"),
        },
      }
    )

    expect(vi.getTimerCount()).toBeGreaterThan(0)

    act(() => {
      vi.setSystemTime(500)
    })
    rerender({
      active: true,
      liveMessage: makeLiveMessage("m1", 100, "abcdefgh"),
    })

    expect(result.current).toEqual({
      tokensPerSecond: 2,
      source: "estimated",
    })

    snapshots.length = 0
    rerender({
      active: false,
      liveMessage: makeLiveMessage("m1", 100, "abcdefgh"),
    })

    expect(snapshots[0]).toEqual(EMPTY_SNAPSHOT)
    expect(result.current).toEqual({
      tokensPerSecond: null,
      source: "estimated",
    })

    expect(vi.getTimerCount()).toBe(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

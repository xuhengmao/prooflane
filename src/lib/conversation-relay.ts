import { getTransport } from "./transport"
import { randomUUID } from "./utils"
import type {
  ConversationCapabilitySettings,
  RelayContextPack,
  RelayPatchInput,
  RelayPreviewInput,
  RelayProvenance,
} from "./types"

const RELAY_PREVIEW_TIMEOUT_MS = 60 * 60_000

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError")
}

function observeAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    )
  })
}

export function getConversationCapabilities(): Promise<ConversationCapabilitySettings> {
  return getTransport().call("get_conversation_capabilities")
}

export function updateConversationCapabilities(input: {
  relayEnabled: boolean
}): Promise<ConversationCapabilitySettings> {
  return getTransport().call("update_conversation_capabilities", input)
}

export async function previewRelayContext(
  input: RelayPreviewInput,
  signal?: AbortSignal
): Promise<RelayContextPack> {
  if (signal?.aborted) return Promise.reject(abortError())
  const requestId = randomUUID()
  const transport = getTransport()
  let cancellation: Promise<unknown> | undefined
  const cancel = () => {
    cancellation ??= transport
      .call("cancel_relay_preview", { requestId })
      .catch(() => false)
    return cancellation
  }

  const reservation = transport.call<boolean>("reserve_relay_preview", {
    requestId,
    targetDraftId: input.targetDraftId,
  })
  let reserved: boolean
  try {
    reserved = await observeAbort(reservation, signal)
  } catch (error) {
    if (signal?.aborted) {
      void reservation
        .then((completed) => (completed ? cancel() : undefined))
        .catch(() => {})
      throw abortError()
    }
    throw error
  }
  if (!reserved) throw new Error("relay_source_unavailable")
  if (signal?.aborted) {
    await cancel()
    throw abortError()
  }

  const cancelOnAbort = () => {
    void cancel()
  }
  signal?.addEventListener("abort", cancelOnAbort, { once: true })
  const preview = transport
    .call<RelayContextPack>(
      "preview_relay_context",
      { ...input, requestId },
      { timeoutMs: RELAY_PREVIEW_TIMEOUT_MS }
    )
    .catch((error) => {
      void cancel()
      throw error
    })
  return observeAbort(preview, signal).finally(() =>
    signal?.removeEventListener("abort", cancelOnAbort)
  )
}

export function getRelayContextByDraft(
  targetDraftId: string
): Promise<RelayContextPack | null> {
  return getTransport().call("get_relay_context_by_draft", { targetDraftId })
}

export function updateRelayContext(
  relayId: number,
  input: RelayPatchInput
): Promise<RelayContextPack> {
  return getTransport().call("update_relay_context", { relayId, input })
}

export function removeRelayContext(relayId: number): Promise<RelayContextPack> {
  return getTransport().call("remove_relay_context", { relayId })
}

export function getConversationRelay(
  conversationId: number
): Promise<RelayProvenance | null> {
  return getTransport().call("get_conversation_relay", { conversationId })
}

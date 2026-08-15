import { getTransport } from "./transport"
import type {
  ConversationCapabilitySettings,
  RelayContextPack,
  RelayPatchInput,
  RelayPreviewInput,
  RelayProvenance,
} from "./types"

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

export function previewRelayContext(
  input: RelayPreviewInput,
  signal?: AbortSignal
): Promise<RelayContextPack> {
  if (signal?.aborted) return Promise.reject(abortError())
  return observeAbort(
    getTransport().call("preview_relay_context", input),
    signal
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

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

export const RELAY_DRAG_MIME = "application/x-prooflane-conversation-relay+json"

export interface RelayDragData {
  conversationId: number
  folderId: number
}

export function resolveRelaySourceFolderId(
  sourceConversationId: number,
  fallbackFolderId: number,
  conversations: ReadonlyArray<{ id: number; folder_id: number }>
): number {
  return (
    conversations.find(
      (conversation) => conversation.id === sourceConversationId
    )?.folder_id ?? fallbackFolderId
  )
}

export function writeRelayDragData(
  dataTransfer: DataTransfer,
  data: RelayDragData
): void {
  dataTransfer.setData(RELAY_DRAG_MIME, JSON.stringify(data))
}

export function hasRelayDragType(
  dataTransfer: Pick<DataTransfer, "types">
): boolean {
  return Array.from(dataTransfer.types).includes(RELAY_DRAG_MIME)
}

export function readRelayDragData(
  dataTransfer: Pick<DataTransfer, "types" | "getData">
): RelayDragData | null {
  if (!hasRelayDragType(dataTransfer)) return null
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(RELAY_DRAG_MIME))
    if (
      !value ||
      typeof value !== "object" ||
      !Number.isInteger((value as RelayDragData).conversationId) ||
      !Number.isInteger((value as RelayDragData).folderId)
    ) {
      return null
    }
    return value as RelayDragData
  } catch {
    return null
  }
}

export interface RelayIntent {
  tabId: string
  sourceConversationId: number
}

const relayIntentByTab = new Map<string, RelayIntent>()
const relayIntentListenersByTab = new Map<string, Set<() => void>>()

/** Queue the source selected before its target draft has mounted. */
export function queueRelayIntent(intent: RelayIntent): void {
  relayIntentByTab.set(intent.tabId, intent)
  for (const listener of relayIntentListenersByTab.get(intent.tabId) ?? []) {
    listener()
  }
}

/** Intents are intentionally single-use: a remount must never re-preview. */
export function consumeRelayIntent(tabId: string): RelayIntent | null {
  const intent = relayIntentByTab.get(tabId) ?? null
  relayIntentByTab.delete(tabId)
  return intent
}

/** Notify a keep-alive draft when a handoff is queued after it mounted. */
export function subscribeRelayIntent(
  tabId: string,
  listener: () => void
): () => void {
  const listeners = relayIntentListenersByTab.get(tabId) ?? new Set()
  listeners.add(listener)
  relayIntentListenersByTab.set(tabId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) relayIntentListenersByTab.delete(tabId)
  }
}

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
  targetDraftId: string,
  targetConversationId?: number | null
): Promise<RelayContextPack | null> {
  return getTransport().call("get_relay_context_by_draft", {
    targetDraftId,
    ...(targetConversationId == null ? {} : { targetConversationId }),
  })
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

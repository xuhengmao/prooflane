export interface ConversationNotificationLocationRequest {
  id: number
  conversationId: number
  messageId: string | null
}

export interface ConversationNotificationLocatableItem {
  key: string
  messageIds: readonly string[]
}

let nextRequestId = 0
let version = 0
const pending = new Map<number, ConversationNotificationLocationRequest>()
const listeners = new Set<() => void>()

function emitChange(): void {
  version += 1
  for (const listener of listeners) listener()
}

export function requestConversationNotificationLocation(input: {
  conversationId: number
  messageId: string | null
}): ConversationNotificationLocationRequest {
  const request = {
    id: ++nextRequestId,
    ...input,
  }
  pending.set(input.conversationId, request)
  emitChange()
  return request
}

export function getConversationNotificationLocation(
  conversationId: number
): ConversationNotificationLocationRequest | null {
  return pending.get(conversationId) ?? null
}

export function consumeConversationNotificationLocation(
  conversationId: number,
  requestId: number
): boolean {
  if (pending.get(conversationId)?.id !== requestId) return false
  pending.delete(conversationId)
  emitChange()
  return true
}

export function subscribeConversationNotificationLocations(
  listener: () => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getConversationNotificationLocationVersion(): number {
  return version
}

export function resolveConversationNotificationLocationIndex(
  items: readonly ConversationNotificationLocatableItem[],
  messageId: string | null
): number {
  if (items.length === 0) return -1
  if (messageId) {
    const targetIndex = items.findIndex(
      (item) => item.key === messageId || item.messageIds.includes(messageId)
    )
    if (targetIndex >= 0) return targetIndex
  }
  return items.length - 1
}

export function resetConversationNotificationLocationsForTests(): void {
  if (process.env.NODE_ENV !== "test") return
  nextRequestId = 0
  version = 0
  pending.clear()
  listeners.clear()
}

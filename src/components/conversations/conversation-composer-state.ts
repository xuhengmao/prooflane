import type { ConnectionStatus } from "@/lib/types"

export function resolveConversationComposerState(isWelcomeMode: boolean) {
  return { isNewConversation: isWelcomeMode }
}

export function resolveConversationComposerErrorState(
  status: ConnectionStatus | null,
  error: string | null,
  onRetry: () => void
) {
  const hasError = status === "error" || Boolean(error)
  return {
    hasError,
    errorMessage: error,
    onRetry: hasError ? onRetry : undefined,
  }
}

export function retryConversationComposerError(
  status: ConnectionStatus | null,
  clearError: () => void,
  reconnect: () => void
) {
  clearError()
  if (status === "error") reconnect()
}

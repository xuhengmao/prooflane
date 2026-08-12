export type SpeechInputStatus =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "finalizing"

export interface ComposerActionStateInput {
  speechStatus: SpeechInputStatus
  isOptimizing: boolean
  hasEditableText: boolean
  disabled: boolean
}

export interface ComposerActionState {
  speechActive: boolean
  canStartSpeech: boolean
  canStopSpeech: boolean
  canOptimize: boolean
}

export function composerActionState({
  speechStatus,
  isOptimizing,
  hasEditableText,
  disabled,
}: ComposerActionStateInput): ComposerActionState {
  const speechActive = speechStatus !== "idle"

  return {
    speechActive,
    canStartSpeech: !disabled && !speechActive && !isOptimizing,
    canStopSpeech: speechActive && !isOptimizing,
    canOptimize: !disabled && !speechActive && !isOptimizing && hasEditableText,
  }
}

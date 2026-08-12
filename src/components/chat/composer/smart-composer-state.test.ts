import {
  composerActionState,
  type SpeechInputStatus,
} from "@/components/chat/composer/smart-composer-state"

describe("composerActionState", () => {
  it("keeps prompt optimization and speech input mutually exclusive", () => {
    expect(
      composerActionState({
        speechStatus: "listening",
        isOptimizing: false,
        hasEditableText: true,
        disabled: false,
      })
    ).toMatchObject({
      canOptimize: false,
      canStartSpeech: false,
      canStopSpeech: true,
    })

    expect(
      composerActionState({
        speechStatus: "idle",
        isOptimizing: true,
        hasEditableText: true,
        disabled: false,
      })
    ).toMatchObject({
      canOptimize: false,
      canStartSpeech: false,
      canStopSpeech: false,
    })
  })

  it.each<SpeechInputStatus>([
    "requesting_permission",
    "listening",
    "finalizing",
  ])("treats %s as an active speech session", (speechStatus) => {
    expect(
      composerActionState({
        speechStatus,
        isOptimizing: false,
        hasEditableText: true,
        disabled: false,
      }).speechActive
    ).toBe(true)
  })
})

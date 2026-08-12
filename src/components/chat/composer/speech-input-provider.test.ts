import {
  WebSpeechTranscriptionProvider,
  isSpeechTranscriptionSupported,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionEvent,
} from "@/components/chat/composer/speech-input-provider"

class FakeRecognition implements BrowserSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ""
  onstart: (() => void) | null = null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn(() => this.onstart?.())
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
}

describe("WebSpeechTranscriptionProvider", () => {
  it("maps browser recognition results into indexed final and interim updates", () => {
    const recognition = new FakeRecognition()
    const onTranscript = vi.fn()
    const provider = new WebSpeechTranscriptionProvider(() => recognition)

    provider.start({
      locale: "zh-CN",
      onTranscript,
      onError: vi.fn(),
      onEnd: vi.fn(),
    })
    recognition.onresult?.({
      resultIndex: 1,
      results: {
        length: 3,
        1: { 0: { transcript: "临时" }, isFinal: false },
        2: { 0: { transcript: "确认" }, isFinal: true },
      },
    })

    expect(recognition.continuous).toBe(true)
    expect(recognition.interimResults).toBe(true)
    expect(onTranscript).toHaveBeenCalledWith([
      { index: 1, text: "临时", isFinal: false },
      { index: 2, text: "确认", isFinal: true },
    ])
  })

  it("detects the prefixed browser implementation", () => {
    expect(
      isSpeechTranscriptionSupported({
        webkitSpeechRecognition: FakeRecognition,
      })
    ).toBe(true)
    expect(isSpeechTranscriptionSupported({})).toBe(false)
  })

  it("does not forward browser callbacks after the session is aborted", () => {
    const recognition = new FakeRecognition()
    const onTranscript = vi.fn()
    const onError = vi.fn()
    const onEnd = vi.fn()
    const provider = new WebSpeechTranscriptionProvider(() => recognition)
    provider.start({
      locale: "en-US",
      onTranscript,
      onError,
      onEnd,
    })

    provider.abort()
    recognition.onresult?.({ resultIndex: 0, results: { length: 0 } })
    recognition.onerror?.({ error: "aborted" })
    recognition.onend?.()

    expect(recognition.abort).toHaveBeenCalledOnce()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })
})

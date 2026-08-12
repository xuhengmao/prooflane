import type { SpeechTranscriptResult } from "@/components/chat/composer/speech-transcript"

export interface BrowserSpeechRecognitionEvent {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      readonly isFinal: boolean
      0: { readonly transcript: string }
    }
  }
}

export interface BrowserSpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type BrowserSpeechRecognitionConstructor =
  new () => BrowserSpeechRecognition

export interface SpeechRecognitionWindow {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

export interface SpeechTranscriptionSessionOptions {
  locale: string
  onStart?: () => void
  onTranscript: (results: SpeechTranscriptResult[]) => void
  onError: (error: string) => void
  onEnd: () => void
}

export interface SpeechTranscriptionProvider {
  start(options: SpeechTranscriptionSessionOptions): void
  stop(): void
  abort(): void
}

function browserRecognitionConstructor(
  target: SpeechRecognitionWindow
): BrowserSpeechRecognitionConstructor | null {
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null
}

export function isSpeechTranscriptionSupported(
  target: SpeechRecognitionWindow = typeof window === "undefined"
    ? {}
    : (window as unknown as SpeechRecognitionWindow)
): boolean {
  return browserRecognitionConstructor(target) != null
}

function defaultRecognitionFactory(): BrowserSpeechRecognition {
  const Constructor = browserRecognitionConstructor(
    window as unknown as SpeechRecognitionWindow
  )
  if (!Constructor) throw new Error("speech-recognition-unsupported")
  return new Constructor()
}

export class WebSpeechTranscriptionProvider implements SpeechTranscriptionProvider {
  private recognition: BrowserSpeechRecognition | null = null

  constructor(
    private readonly createRecognition: () => BrowserSpeechRecognition = defaultRecognitionFactory
  ) {}

  start(options: SpeechTranscriptionSessionOptions): void {
    this.abort()
    const recognition = this.createRecognition()
    this.recognition = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = options.locale
    recognition.onstart = () => options.onStart?.()
    recognition.onresult = (event) => {
      const results: SpeechTranscriptResult[] = []
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index]
        results.push({
          index,
          text: result?.[0]?.transcript ?? "",
          isFinal: Boolean(result?.isFinal),
        })
      }
      options.onTranscript(results)
    }
    recognition.onerror = (event) => options.onError(event.error)
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null
      options.onEnd()
    }
    recognition.start()
  }

  stop(): void {
    this.recognition?.stop()
  }

  abort(): void {
    const recognition = this.recognition
    this.recognition = null
    if (!recognition) return
    recognition.onstart = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.abort()
  }
}

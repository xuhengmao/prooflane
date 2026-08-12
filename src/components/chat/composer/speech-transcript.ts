export interface SpeechTranscriptResult {
  index: number
  text: string
  isFinal: boolean
}

export interface SpeechTranscriptUpdate {
  confirmed: string[]
  interim: string
}

export class SpeechTranscriptBuffer {
  private readonly committedIndexes = new Set<number>()

  update(results: SpeechTranscriptResult[]): SpeechTranscriptUpdate {
    const confirmed: string[] = []
    const interim: Array<{ index: number; text: string }> = []

    for (const result of results) {
      const text = result.text.trim()
      if (!text) continue

      if (result.isFinal) {
        if (!this.committedIndexes.has(result.index)) {
          this.committedIndexes.add(result.index)
          confirmed.push(text)
        }
      } else if (!this.committedIndexes.has(result.index)) {
        interim.push({ index: result.index, text })
      }
    }

    interim.sort((left, right) => left.index - right.index)
    return {
      confirmed,
      interim: interim.map((result) => result.text).join(" "),
    }
  }

  reset(): void {
    this.committedIndexes.clear()
  }
}

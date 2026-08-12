import { SpeechTranscriptBuffer } from "@/components/chat/composer/speech-transcript"

describe("SpeechTranscriptBuffer", () => {
  it("emits each confirmed result once while interim text remains preview-only", () => {
    const buffer = new SpeechTranscriptBuffer()

    expect(buffer.update([{ index: 0, text: "你好", isFinal: false }])).toEqual(
      {
        confirmed: [],
        interim: "你好",
      }
    )
    expect(
      buffer.update([{ index: 0, text: "你好世界", isFinal: true }])
    ).toEqual({
      confirmed: ["你好世界"],
      interim: "",
    })
    expect(
      buffer.update([{ index: 0, text: "你好世界", isFinal: true }])
    ).toEqual({
      confirmed: [],
      interim: "",
    })
  })

  it("keeps later interim results ordered without committing them", () => {
    const buffer = new SpeechTranscriptBuffer()
    expect(
      buffer.update([
        { index: 3, text: "第三段", isFinal: false },
        { index: 2, text: "第二段", isFinal: false },
      ]).interim
    ).toBe("第二段 第三段")
  })
})

import { render } from "@testing-library/react"
import { SpeechWaveform } from "@/components/chat/composer/speech-waveform"

describe("SpeechWaveform", () => {
  it("renders exactly 28 stable meter segments", () => {
    const { container } = render(
      <SpeechWaveform
        levels={Array.from({ length: 28 }, (_, index) => index / 27)}
        backgroundImage="/prooflane/composer/call_wen.png"
      />
    )

    expect(
      container.querySelectorAll('[data-wave-segment="true"]')
    ).toHaveLength(28)
    expect(container.innerHTML).toContain(
      "url(&quot;/prooflane/composer/call_wen.png&quot;)"
    )
  })
})

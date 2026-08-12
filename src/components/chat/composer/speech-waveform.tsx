import { cn } from "@/lib/utils"

const SEGMENT_COUNT = 28

interface SpeechWaveformProps {
  levels: readonly number[]
  className?: string
  label?: string
  backgroundImage?: string
}

export function SpeechWaveform({
  levels,
  className,
  label,
  backgroundImage,
}: SpeechWaveformProps) {
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn(
        "prooflane-speech-waveform relative flex h-6 w-[94px] max-w-[24vw] items-center justify-center gap-px overflow-hidden",
        className
      )}
    >
      {backgroundImage && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-contain bg-center bg-no-repeat opacity-30"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
      )}
      {Array.from({ length: SEGMENT_COUNT }, (_, index) => {
        const level = Math.min(1, Math.max(0, levels[index] ?? 0.18))
        return (
          <span
            key={index}
            data-wave-segment="true"
            aria-hidden="true"
            className="relative block h-full w-0.5 origin-center rounded-full bg-muted-foreground transition-[transform,opacity] duration-75"
            style={{
              transform: `scaleY(${0.18 + level * 0.82})`,
              opacity: 0.42 + level * 0.58,
            }}
          />
        )
      })}
    </div>
  )
}

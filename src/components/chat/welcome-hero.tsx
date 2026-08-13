"use client"

import Image from "next/image"
import { useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Lightbulb } from "lucide-react"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useIsMac } from "@/hooks/use-is-mac"
import {
  formatShortcutLabel,
  type ShortcutSettings,
} from "@/lib/keyboard-shortcuts"

type TipKey =
  | "tileTabs"
  | "pinTab"
  | "shortcutsNewSearch"
  | "slashAtMention"
  | "pasteDropFiles"
  | "queueMessage"
  | "draftAutoSave"
  | "forkSend"
  | "exportConversation"
  | "chatChannels"
  | "shortcutsAuxPanel"
  | "shortcutsTerminalSidebar"
  | "customShortcuts"
  | "webService"
  | "fusionMode"
  | "quickMessages"
  | "experts"
  | "taskBoard"
  | "automations"
  | "tokenUsage"
  | "mentionTargets"
  | "splitGroups"
  | "worktrees"
  | "importSessions"
  | "subSessions"
  | "liveFeedback"
  | "skillPacks"
  | "modelProviders"
  | "workspaceBackground"

interface TipDef {
  key: TipKey
  buildValues?: (ctx: {
    shortcuts: ShortcutSettings
    isMac: boolean
    kbd: (chunks: ReactNode) => ReactNode
  }) => Record<string, ReactNode | ((chunks: ReactNode) => ReactNode) | string>
}

const TIPS: TipDef[] = [
  { key: "tileTabs" },
  { key: "pinTab" },
  {
    key: "shortcutsNewSearch",
    buildValues: ({ shortcuts, isMac, kbd }) => ({
      shortcut: kbd,
      newConversation: formatShortcutLabel(shortcuts.new_conversation, isMac),
      searchConversations: formatShortcutLabel(shortcuts.toggle_search, isMac),
    }),
  },
  { key: "slashAtMention" },
  { key: "pasteDropFiles" },
  { key: "queueMessage" },
  { key: "draftAutoSave" },
  { key: "forkSend" },
  { key: "exportConversation" },
  { key: "chatChannels" },
  {
    key: "shortcutsAuxPanel",
    buildValues: ({ shortcuts, isMac, kbd }) => ({
      shortcut: kbd,
      toggleAuxPanel: formatShortcutLabel(shortcuts.toggle_aux_panel, isMac),
    }),
  },
  {
    key: "shortcutsTerminalSidebar",
    buildValues: ({ shortcuts, isMac, kbd }) => ({
      shortcut: kbd,
      toggleTerminal: formatShortcutLabel(shortcuts.toggle_terminal, isMac),
      toggleSidebar: formatShortcutLabel(shortcuts.toggle_sidebar, isMac),
    }),
  },
  { key: "customShortcuts" },
  { key: "webService" },
  { key: "fusionMode" },
  { key: "quickMessages" },
  { key: "experts" },
  { key: "taskBoard" },
  { key: "automations" },
  { key: "tokenUsage" },
  { key: "mentionTargets" },
  { key: "splitGroups" },
  { key: "worktrees" },
  { key: "importSessions" },
  { key: "subSessions" },
  { key: "liveFeedback" },
  { key: "skillPacks" },
  { key: "modelProviders" },
  { key: "workspaceBackground" },
]

const highlightTip = (chunks: ReactNode) => (
  <span className="font-medium text-primary">{chunks}</span>
)

const WELCOME_FRAMES = [
  "/prooflane/welcome/index_stp_1.png",
  "/prooflane/welcome/index_stp_2.png",
  "/prooflane/welcome/index_stp_3.png",
  "/prooflane/welcome/index_stp_4.png",
] as const

export function WelcomeHero() {
  const t = useTranslations("Folder.chat.welcomePanel")

  return (
    <section
      className="flex w-full flex-col items-center text-center"
      aria-labelledby="prooflane-welcome-title"
    >
      <div
        data-testid="prooflane-welcome-animation"
        className="relative aspect-[12/5] w-full max-w-[16.25rem] shrink-0 sm:max-w-[22.5rem]"
      >
        {WELCOME_FRAMES.map((src, index) => (
          <Image
            key={src}
            src={src}
            alt={index === 0 ? t("animationAlt") : ""}
            aria-hidden={index === 0 ? undefined : true}
            fill
            unoptimized
            loading="eager"
            decoding="async"
            sizes="(min-width: 640px) 360px, 260px"
            draggable={false}
            className={`prooflane-welcome-frame ${
              index === 0
                ? "prooflane-welcome-frame-base"
                : `prooflane-welcome-frame-overlay prooflane-welcome-frame-${index + 1}`
            } absolute inset-0 h-full w-full select-none object-contain`}
          />
        ))}
      </div>
      <div className="mt-3 flex max-w-full flex-col items-center gap-1.5 px-2 sm:mt-4 sm:gap-2">
        <h1
          id="prooflane-welcome-title"
          className="max-w-full break-words text-2xl font-semibold tracking-normal text-foreground sm:text-3xl"
        >
          {t("title")}
        </h1>
        <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground sm:text-base">
          {t("subtitle")}
        </p>
      </div>
    </section>
  )
}

export function WelcomeTip() {
  const t = useTranslations("Folder.chat.welcomePanel")
  const { shortcuts } = useShortcutSettings()
  const isMac = useIsMac()

  const [tipIndex] = useState(() => Math.floor(Math.random() * TIPS.length))
  const tip = TIPS[tipIndex]

  const kbd = (chunks: ReactNode) => (
    <kbd className="mx-0.5 inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-foreground/80">
      {chunks}
    </kbd>
  )

  const values = {
    ...(tip.buildValues?.({ shortcuts, isMac, kbd }) ?? {}),
    highlight: highlightTip,
  }
  const tipNode = t.rich(
    `tips.${tip.key}` as Parameters<typeof t.rich>[0],
    values as Parameters<typeof t.rich>[1]
  )

  return (
    <div className="flex max-w-full justify-center">
      <div className="flex max-w-full items-start gap-2 rounded-full border border-border/40 bg-muted/40 px-4 py-1.5 text-center text-xs text-muted-foreground/90">
        <span className="flex h-[1.375em] shrink-0 items-center">
          <Lightbulb aria-hidden className="h-3.5 w-3.5 text-primary" />
        </span>
        <p className="min-w-0 leading-snug">{tipNode}</p>
      </div>
    </div>
  )
}

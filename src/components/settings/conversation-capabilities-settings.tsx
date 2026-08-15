"use client"

import { Loader2, MessagesSquare } from "lucide-react"

import { SettingsSection } from "@/components/shared/settings-section"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { useConversationCapabilities } from "@/hooks/use-conversation-capabilities"

export function ConversationCapabilitiesSettings() {
  const { settings, loading, setRelayEnabled } = useConversationCapabilities()

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        <section className="space-y-1">
          <h1 className="text-sm font-semibold">会话接力</h1>
          <p className="text-xs text-muted-foreground">
            在新会话开始前，按需携带已选择会话的上下文。
          </p>
        </section>
        <SettingsSection
          icon={MessagesSquare}
          title="启用会话接力"
          description="允许在创建新会话时预览和附加选定的历史上下文。"
          htmlFor="conversation-relay-enabled"
          control={
            <Switch
              id="conversation-relay-enabled"
              checked={settings.relayEnabled}
              disabled={loading}
              onCheckedChange={(relayEnabled) =>
                void setRelayEnabled(relayEnabled)
              }
            />
          }
        >
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              正在读取设置
            </div>
          ) : null}
        </SettingsSection>
      </div>
    </ScrollArea>
  )
}

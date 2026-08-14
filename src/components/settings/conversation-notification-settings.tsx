"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  BellRing,
  CircleCheck,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from "lucide-react"
import { SettingCard, SettingRow } from "@/components/shared/setting-card"
import { SettingsSection } from "@/components/shared/settings-section"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  saveConversationNotificationPrefs,
  useConversationNotificationPrefs,
} from "@/lib/conversation-notification-prefs"
import { conversationNotificationRuntime } from "@/lib/conversation-notification-runtime"
import type { ConversationNotificationPermission } from "@/lib/conversation-notification"
import { toErrorMessage } from "@/lib/app-error"

export function ConversationNotificationSettingsSection() {
  const t = useTranslations("ConversationNotifications")
  const prefs = useConversationNotificationPrefs()
  const [permission, setPermission] =
    useState<ConversationNotificationPermission | null>(null)
  const [checking, setChecking] = useState(false)
  const [acting, setActing] = useState(false)
  const checkSequenceRef = useRef(0)
  const translationsRef = useRef(t)
  useEffect(() => {
    translationsRef.current = t
  }, [t])

  const refreshPermission = useCallback(async () => {
    const sequence = ++checkSequenceRef.current
    setChecking(true)
    try {
      const state = await conversationNotificationRuntime.getState()
      if (sequence === checkSequenceRef.current) {
        setPermission(state.permission)
      }
    } catch (error) {
      if (sequence === checkSequenceRef.current) {
        toast.error(
          translationsRef.current("permissionCheckFailed", {
            message: toErrorMessage(error),
          })
        )
      }
    } finally {
      if (sequence === checkSequenceRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!prefs.enabled) {
      checkSequenceRef.current += 1
      setPermission(null)
      setChecking(false)
      return
    }

    void refreshPermission()
    const handleFocus = () => void refreshPermission()
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [prefs.enabled, refreshPermission])

  const requestPermission = useCallback(async () => {
    setActing(true)
    try {
      const result = await conversationNotificationRuntime.requestPermission()
      setPermission(result.permission)
    } catch (error) {
      toast.error(
        t("permissionRequestFailed", { message: toErrorMessage(error) })
      )
    } finally {
      setActing(false)
    }
  }, [t])

  const openSettings = useCallback(async () => {
    setActing(true)
    try {
      const opened = await conversationNotificationRuntime.openSettings()
      if (!opened) toast.info(t("browserSettingsHint"))
    } catch (error) {
      toast.error(t("openSettingsFailed", { message: toErrorMessage(error) }))
    } finally {
      setActing(false)
    }
  }, [t])

  const permissionTitle = checking
    ? t("permission.checking")
    : permission === "granted"
      ? t("permission.granted")
      : permission === "denied"
        ? t("permission.denied")
        : permission === "prompt"
          ? t("permission.prompt")
          : permission === "unsupported"
            ? t("permission.unsupported")
            : null

  return (
    <SettingsSection
      icon={BellRing}
      title={t("title")}
      description={t("description")}
      htmlFor="conversation-notification-enabled"
      control={
        <Switch
          id="conversation-notification-enabled"
          checked={prefs.enabled}
          onCheckedChange={(enabled) =>
            saveConversationNotificationPrefs({ ...prefs, enabled })
          }
        />
      }
    >
      {prefs.enabled && permissionTitle ? (
        <SettingCard>
          <SettingRow
            icon={
              checking
                ? Loader2
                : permission === "granted"
                  ? CircleCheck
                  : ShieldAlert
            }
            title={permissionTitle}
            description={
              permission === "prompt"
                ? t("permission.promptHint")
                : permission === "denied"
                  ? t("permission.deniedHint")
                  : permission === "unsupported"
                    ? t("permission.unsupportedHint")
                    : undefined
            }
            control={
              permission === "prompt" && !checking ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => void requestPermission()}
                >
                  {acting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t("allow")}
                </Button>
              ) : permission === "denied" && !checking ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => void openSettings()}
                >
                  {acting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="size-3.5" />
                  )}
                  {t("openSettings")}
                </Button>
              ) : undefined
            }
          />
        </SettingCard>
      ) : null}
    </SettingsSection>
  )
}

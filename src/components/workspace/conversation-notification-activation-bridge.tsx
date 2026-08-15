"use client"

import { useCallback, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useAlertContext } from "@/contexts/alert-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabStore } from "@/stores/tab-store"
import {
  activateConversationNotification,
  installConversationNotificationActivationListeners,
} from "@/lib/conversation-notification-activation"
import { requestConversationNotificationLocation } from "@/lib/conversation-notification-location"
import { conversationNotificationRuntime } from "@/lib/conversation-notification-runtime"
import type { ConversationNotificationActivationPayload } from "@/lib/conversation-notification"
import { getShellTransport, isDesktop } from "@/lib/transport"
import { toErrorMessage } from "@/lib/app-error"

export function ConversationNotificationActivationBridge() {
  const t = useTranslations("ConversationNotifications")
  const { pushAlert } = useAlertContext()
  const { openConversations } = useWorkbenchRoute()

  const handleActivation = useCallback(
    (payload: ConversationNotificationActivationPayload) => {
      void activateConversationNotification(payload, {
        getConversations: () => useAppWorkspaceStore.getState().conversations,
        refreshConversations: () =>
          useAppWorkspaceStore.getState().refreshConversations(),
        openConversation: (target) => {
          openConversations()
          useTabStore
            .getState()
            .openTab(
              target.folderId,
              target.conversationId,
              target.agentType,
              true,
              target.title ?? undefined
            )
        },
        requestLocation: requestConversationNotificationLocation,
        markClicked: (activation) =>
          conversationNotificationRuntime.markClicked(activation),
        reportMissing: (conversationId) => {
          pushAlert(
            "error",
            t("activation.missingTitle"),
            t("activation.missingDetail", { id: conversationId })
          )
        },
      }).catch((error) => {
        pushAlert(
          "error",
          t("activation.failedTitle"),
          t("activation.failedDetail", { message: toErrorMessage(error) })
        )
      })
    },
    [openConversations, pushAlert, t]
  )

  useEffect(
    () =>
      installConversationNotificationActivationListeners({
        target: window,
        desktop: isDesktop(),
        subscribeShell: (event, handler) =>
          getShellTransport().subscribe(event, handler),
        onActivation: handleActivation,
      }),
    [handleActivation]
  )

  return null
}

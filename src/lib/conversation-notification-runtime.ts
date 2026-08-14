"use client"

import {
  createConversationNotificationCoordinator,
  getBrowserConversationNotificationState,
  requestBrowserConversationNotificationPermission,
  sendBrowserConversationNotification,
  type ConversationNotificationActivationPayload,
  type ConversationNotificationCopy,
  type ConversationNotificationDelivery,
  type ConversationNotificationRequest,
  type ConversationNotificationResult,
  type ConversationNotificationState,
  type NativeConversationNotification,
} from "./conversation-notification"
import { getConversationNotificationPrefs } from "./conversation-notification-prefs"
import { getShellTransport, getTransport, isDesktop } from "./transport"

type TransportCall = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>

export interface ConversationNotificationRuntimeDependencies {
  isDesktop(): boolean
  isEnabled(): boolean
  receiptCall: TransportCall
  shellCall: TransportCall
  getBrowserState(): Promise<ConversationNotificationState>
  requestBrowserPermission(): Promise<{
    permission: ConversationNotificationState["permission"]
  }>
  sendBrowser(
    notification: NativeConversationNotification
  ): Promise<ConversationNotificationDelivery>
}

export function createConversationNotificationRuntime(
  deps: ConversationNotificationRuntimeDependencies
) {
  const getState = (): Promise<ConversationNotificationState> =>
    deps.isDesktop()
      ? deps.shellCall("get_conversation_notification_state")
      : deps.getBrowserState()

  const coordinator = createConversationNotificationCoordinator({
    isEnabled: deps.isEnabled,
    getState,
    claim: (claim) =>
      deps.receiptCall("claim_conversation_notification", { ...claim }),
    release: (key) =>
      deps.receiptCall("release_conversation_notification", { ...key }),
    send: (notification) =>
      deps.isDesktop()
        ? deps.shellCall("send_conversation_notification", { ...notification })
        : deps.sendBrowser(notification),
  })

  return {
    notify(
      request: ConversationNotificationRequest,
      copy: ConversationNotificationCopy
    ): Promise<ConversationNotificationResult> {
      return coordinator.notify(request, copy)
    },

    getState,

    requestPermission(): Promise<{
      permission: ConversationNotificationState["permission"]
    }> {
      return deps.isDesktop()
        ? deps.shellCall("request_conversation_notification_permission")
        : deps.requestBrowserPermission()
    },

    async openSettings(): Promise<boolean> {
      if (!deps.isDesktop()) return false
      await deps.shellCall("open_conversation_notification_settings")
      return true
    },

    markClicked(
      payload: ConversationNotificationActivationPayload
    ): Promise<{ updated: boolean }> {
      return deps.receiptCall("mark_conversation_notification_clicked", {
        conversationId: payload.conversationId,
        runId: payload.runId,
        notificationType: payload.notificationType,
      })
    },
  }
}

export const conversationNotificationRuntime =
  createConversationNotificationRuntime({
    isDesktop,
    isEnabled: () => getConversationNotificationPrefs().enabled,
    receiptCall: <T>(command: string, args?: Record<string, unknown>) =>
      getTransport().call<T>(command, args),
    shellCall: <T>(command: string, args?: Record<string, unknown>) =>
      getShellTransport().call<T>(command, args),
    getBrowserState: getBrowserConversationNotificationState,
    requestBrowserPermission: requestBrowserConversationNotificationPermission,
    sendBrowser: sendBrowserConversationNotification,
  })

"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RelayContextPack, RelayScopeSelection } from "@/lib/types"
import {
  RelayConversationPicker,
  type RelayPickerConversation,
  type RelayPickerFolder,
} from "./relay-conversation-picker"
import { RelayScopeEditor } from "./relay-scope-editor"
import { RelayPreviewDrawer } from "./relay-preview-drawer"

interface RelayDialogControllerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversations: RelayPickerConversation[]
  folders: RelayPickerFolder[]
  currentFolderId: number | null
  relay: RelayContextPack | null
  loading: boolean
  previewOpen: boolean
  onPreviewOpenChange: (open: boolean) => void
  onPreview: (
    sourceConversationId: number,
    scope?: RelayScopeSelection
  ) => Promise<void>
  onUpdateScope: (scope: RelayScopeSelection) => Promise<void>
}

export function RelayDialogController({
  open,
  onOpenChange,
  conversations,
  folders,
  currentFolderId,
  relay,
  loading,
  previewOpen,
  onPreviewOpenChange,
  onPreview,
  onUpdateScope,
}: RelayDialogControllerProps) {
  const t = useTranslations("Folder.chat.relay")
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [scopePending, setScopePending] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [summaryState, setSummaryState] = useState<
    "idle" | "loading" | "error"
  >("idle")
  const previewPendingRef = useRef(false)
  const scopePendingRef = useRef(false)
  const operationGenerationRef = useRef(0)
  const sourceId = relay?.sourceConversationId ?? selectedConversationId
  const sourceTitle = conversations.find(
    (conversation) => conversation.id === sourceId
  )?.title
  const rounds = relay?.snapshot.availableRounds ?? []

  const select = async (conversationId: number) => {
    if (previewPendingRef.current) return
    previewPendingRef.current = true
    const generation = ++operationGenerationRef.current
    setSelectedConversationId(conversationId)
    setOperationError(null)
    setPreviewPending(true)
    try {
      await onPreview(conversationId)
      if (operationGenerationRef.current === generation) onOpenChange(false)
    } catch {
      if (operationGenerationRef.current === generation) {
        setOperationError(t("sourceUnavailable"))
      }
    } finally {
      previewPendingRef.current = false
      if (operationGenerationRef.current === generation) {
        setPreviewPending(false)
      }
    }
  }

  const changeScope = async (scope: RelayScopeSelection) => {
    if (scopePendingRef.current) return
    scopePendingRef.current = true
    const generation = ++operationGenerationRef.current
    const updatingSummary = scope.scopeType === "summary"
    setOperationError(null)
    setScopePending(true)
    setSummaryState(updatingSummary ? "loading" : "idle")
    try {
      await onUpdateScope(scope)
      if (operationGenerationRef.current === generation) {
        setSummaryState("idle")
      }
    } catch {
      if (operationGenerationRef.current === generation) {
        setSummaryState(updatingSummary ? "error" : "idle")
        setOperationError(t("scopeUpdateFailed"))
      }
    } finally {
      scopePendingRef.current = false
      if (operationGenerationRef.current === generation) {
        setScopePending(false)
      }
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
          </DialogHeader>
          {relay && sourceId != null ? (
            <div className="space-y-3">
              <RelayScopeEditor
                rounds={rounds}
                value={relay.scope}
                summaryState={summaryState}
                disabled={scopePending}
                onChange={(scope) => void changeScope(scope)}
              />
              <button
                type="button"
                onClick={() => onPreviewOpenChange(true)}
                className="text-sm text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("viewContent")}
              </button>
            </div>
          ) : (
            <RelayConversationPicker
              conversations={conversations}
              folders={folders}
              currentFolderId={currentFolderId}
              selectedConversationId={selectedConversationId}
              busy={previewPending}
              onSelect={(conversationId) => void select(conversationId)}
            />
          )}
          {operationError && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-xs text-destructive"
            >
              <span>{operationError}</span>
              {!relay && selectedConversationId != null && (
                <button
                  type="button"
                  onClick={() => void select(selectedConversationId)}
                  className="rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("retry")}
                </button>
              )}
            </div>
          )}
          {(loading || previewPending) && summaryState !== "loading" && (
            <p className="text-xs text-muted-foreground">{t("preparing")}</p>
          )}
        </DialogContent>
      </Dialog>
      <RelayPreviewDrawer
        open={previewOpen}
        onOpenChange={onPreviewOpenChange}
        relay={relay}
        sourceTitle={sourceTitle}
      />
    </>
  )
}

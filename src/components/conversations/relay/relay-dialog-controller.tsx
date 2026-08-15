"use client"

import { useRef, useState } from "react"
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
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [summaryState, setSummaryState] = useState<
    "idle" | "loading" | "error"
  >("idle")
  const operationGenerationRef = useRef(0)
  const sourceId = relay?.sourceConversationId ?? selectedConversationId
  const rounds = relay?.snapshot.availableRounds ?? []

  const select = async (conversationId: number) => {
    const generation = ++operationGenerationRef.current
    setSelectedConversationId(conversationId)
    setOperationError(null)
    setPreviewPending(true)
    try {
      await onPreview(conversationId)
      if (operationGenerationRef.current === generation) onOpenChange(false)
    } catch {
      if (operationGenerationRef.current === generation) {
        setOperationError("接力上下文准备失败，请重试")
      }
    } finally {
      if (operationGenerationRef.current === generation) {
        setPreviewPending(false)
      }
    }
  }

  const changeScope = async (scope: RelayScopeSelection) => {
    const generation = ++operationGenerationRef.current
    const updatingSummary = scope.scopeType === "summary"
    setOperationError(null)
    setSummaryState(updatingSummary ? "loading" : "idle")
    try {
      await onUpdateScope(scope)
      if (operationGenerationRef.current === generation) {
        setSummaryState("idle")
      }
    } catch {
      if (operationGenerationRef.current === generation) {
        setSummaryState(updatingSummary ? "error" : "idle")
        setOperationError("接力范围更新失败，请重试")
      }
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>接入历史会话</DialogTitle>
          </DialogHeader>
          {relay && sourceId != null ? (
            <div className="space-y-3">
              <RelayScopeEditor
                rounds={rounds}
                value={relay.scope}
                summaryState={summaryState}
                onChange={(scope) => void changeScope(scope)}
              />
              <button
                type="button"
                onClick={() => onPreviewOpenChange(true)}
                className="text-sm text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                查看接力内容
              </button>
            </div>
          ) : (
            <RelayConversationPicker
              conversations={conversations}
              folders={folders}
              currentFolderId={currentFolderId}
              selectedConversationId={selectedConversationId}
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
                  重试
                </button>
              )}
            </div>
          )}
          {(loading || previewPending) && summaryState !== "loading" && (
            <p className="text-xs text-muted-foreground">正在准备接力上下文</p>
          )}
        </DialogContent>
      </Dialog>
      <RelayPreviewDrawer
        open={previewOpen}
        onOpenChange={onPreviewOpenChange}
        relay={relay}
      />
    </>
  )
}

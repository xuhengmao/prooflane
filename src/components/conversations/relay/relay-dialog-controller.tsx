"use client"

import { useState } from "react"
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
  const sourceId = relay?.sourceConversationId ?? selectedConversationId
  const rounds = relay?.snapshot.availableRounds ?? []

  const select = async (conversationId: number) => {
    setSelectedConversationId(conversationId)
    try {
      await onPreview(conversationId)
      onOpenChange(false)
    } catch {
      // The persisted hook keeps the failed operation available for retry.
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
                onChange={(scope) => void onUpdateScope(scope)}
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
          {loading && (
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

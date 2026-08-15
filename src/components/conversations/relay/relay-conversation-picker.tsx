"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RelayPickerConversation {
  id: number
  folder_id: number
  title: string | null
  agent_type: string
}

export interface RelayPickerFolder {
  id: number
  name: string
}

interface RelayConversationPickerProps {
  conversations: RelayPickerConversation[]
  folders: RelayPickerFolder[]
  currentFolderId: number | null
  selectedConversationId: number | null
  onSelect: (conversationId: number) => void
}

export function RelayConversationPicker({
  conversations,
  folders,
  currentFolderId,
  selectedConversationId,
  onSelect,
}: RelayConversationPickerProps) {
  const [allProjects, setAllProjects] = useState(currentFolderId === null)
  const [query, setQuery] = useState("")
  const folderNames = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return conversations.filter((conversation) => {
      if (!allProjects && conversation.folder_id !== currentFolderId)
        return false
      if (!needle) return true
      return [
        conversation.title ?? "",
        folderNames.get(conversation.folder_id) ?? "",
        conversation.agent_type,
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [allProjects, conversations, currentFolderId, folderNames, query])

  return (
    <div className="space-y-3">
      {currentFolderId === null && (
        <p className="text-xs text-muted-foreground">当前会话未关联项目</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(
            "rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !allProjects && "bg-accent"
          )}
          onClick={() => setAllProjects(false)}
          disabled={currentFolderId === null}
        >
          当前项目
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            allProjects && "bg-accent"
          )}
          onClick={() => setAllProjects(true)}
        >
          全部项目
        </button>
      </div>
      <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          type="search"
          role="searchbox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <div className="max-h-64 space-y-1 overflow-y-auto" role="radiogroup">
        {visible.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            role="radio"
            aria-checked={selectedConversationId === conversation.id}
            onClick={() => onSelect(conversation.id)}
            className={cn(
              "flex w-full flex-col rounded-md px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedConversationId === conversation.id
                ? "bg-accent"
                : "hover:bg-muted"
            )}
          >
            <span className="truncate">
              {conversation.title || "未命名会话"}
            </span>
            <span className="text-xs text-muted-foreground">
              {folderNames.get(conversation.folder_id) ?? "未知项目"} ·{" "}
              {conversation.agent_type}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
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
  busy?: boolean
  onSelect: (conversationId: number) => void
}

export function RelayConversationPicker({
  conversations,
  folders,
  currentFolderId,
  selectedConversationId,
  busy = false,
  onSelect,
}: RelayConversationPickerProps) {
  const t = useTranslations("Folder.chat.relay")
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
        <p className="text-xs text-muted-foreground">{t("noProject")}</p>
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
          {t("currentProject")}
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            allProjects && "bg-accent"
          )}
          onClick={() => setAllProjects(true)}
        >
          {t("allProjects")}
        </button>
      </div>
      <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          type="search"
          role="searchbox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <div
        className="max-h-64 w-full min-w-0 max-w-full space-y-1 overflow-x-hidden overflow-y-auto"
        role="radiogroup"
      >
        {visible.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            role="radio"
            aria-checked={selectedConversationId === conversation.id}
            disabled={busy}
            onClick={() => onSelect(conversation.id)}
            className={cn(
              "flex w-full min-w-0 flex-col overflow-hidden rounded-md px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
              selectedConversationId === conversation.id
                ? "bg-accent"
                : "hover:bg-muted"
            )}
          >
            <span
              className="block w-full truncate"
              title={conversation.title || t("untitledConversation")}
            >
              {conversation.title || t("untitledConversation")}
            </span>
            <span
              className="block w-full truncate text-xs text-muted-foreground"
              title={`${folderNames.get(conversation.folder_id) ?? t("unknownProject")} · ${conversation.agent_type}`}
            >
              {folderNames.get(conversation.folder_id) ?? t("unknownProject")} ·{" "}
              {conversation.agent_type}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

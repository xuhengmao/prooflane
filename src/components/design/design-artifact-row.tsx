"use client"

import { useState } from "react"
import {
  Archive,
  ArchiveRestore,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DesignArtifact } from "@/lib/design/artifact"

interface DesignArtifactRowProps {
  artifact: DesignArtifact
  busy: boolean
  onOpen: () => void
  onRename: (name: string) => Promise<void>
  onDuplicate: () => Promise<void>
  onArchive: (archived: boolean) => Promise<void>
  onDelete: () => Promise<void>
}

export function DesignArtifactRow({
  artifact,
  busy,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
  onDelete,
}: DesignArtifactRowProps) {
  const t = useTranslations("Design")
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState(artifact.name)

  return (
    <div className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/35">
      <button
        type="button"
        className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("openNamed", { name: artifact.name })}
        onClick={onOpen}
      >
        <span className="block truncate text-sm font-medium">
          {artifact.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t(`kinds.${artifact.kind}`)} · {t(`statuses.${artifact.status}`)}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={t("moreActions", { name: artifact.name })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setName(artifact.name)
              setRenameOpen(true)
            }}
          >
            <Pencil /> {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onDuplicate()}>
            <Copy /> {t("duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onArchive(artifact.status !== "archived")}
          >
            {artifact.status === "archived" ? <ArchiveRestore /> : <Archive />}
            {artifact.status === "archived" ? t("restore") : t("archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 /> {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="rounded-lg">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`rename-${artifact.id}`}>{t("name")}</Label>
            <Input
              id={`rename-${artifact.id}`}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || name.trim().length === 0}
              onClick={async () => {
                await onRename(name.trim())
                setRenameOpen(false)
              }}
            >
              {t("saveName")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { name: artifact.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>
              {t("deleteDesign")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

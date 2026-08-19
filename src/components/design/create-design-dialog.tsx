"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DesignArtifactKind } from "@/lib/design/artifact"

const KINDS: DesignArtifactKind[] = [
  "page",
  "component",
  "image",
  "icon",
  "design_system",
  "flow",
]

interface CreateDesignDialogProps {
  open: boolean
  busy: boolean
  initialName?: string
  onOpenChange: (open: boolean) => void
  onCreate: (name: string, kind: DesignArtifactKind) => Promise<void>
}

export function CreateDesignDialog({
  open,
  busy,
  initialName = "",
  onOpenChange,
  onCreate,
}: CreateDesignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CreateDesignDialogContent
          busy={busy}
          initialName={initialName}
          onOpenChange={onOpenChange}
          onCreate={onCreate}
        />
      ) : null}
    </Dialog>
  )
}

function CreateDesignDialogContent({
  busy,
  initialName,
  onOpenChange,
  onCreate,
}: Omit<CreateDesignDialogProps, "open" | "initialName"> & {
  initialName: string
}) {
  const t = useTranslations("Design")
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<DesignArtifactKind>("page")

  return (
    <DialogContent className="rounded-lg">
      <DialogHeader>
        <DialogTitle>{t("newDesign")}</DialogTitle>
        <DialogDescription>{t("createDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="design-name">{t("name")}</Label>
          <Input
            id="design-name"
            value={name}
            maxLength={120}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="design-kind">{t("type")}</Label>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as DesignArtifactKind)}
          >
            <SelectTrigger id="design-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`kinds.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          {t("cancel")}
        </Button>
        <Button
          onClick={() => onCreate(name.trim(), kind)}
          disabled={busy || name.trim().length === 0}
        >
          {t("createDesign")}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  Box,
  Check,
  Layers3,
  PanelLeft,
  PanelRight,
  Save,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDesignWorkspace } from "@/contexts/design-workspace-context"
import type {
  DesignArtifactDetail,
  DesignArtifactService,
} from "@/lib/design/artifact-service"
import { desktopDesignArtifactService } from "@/lib/design/artifact-service"
import { DesignCanvasHost } from "./design-canvas-host"
import { DesignComposerHost } from "./design-composer-host"

type WorkspaceView = "design" | "prototype" | "run"
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict"

interface DesignWorkspaceProps {
  artifactId: string
  service?: DesignArtifactService
  onBack?: () => void
}

export function DesignWorkspace({
  artifactId,
  service = desktopDesignArtifactService,
  onBack,
}: DesignWorkspaceProps) {
  const t = useTranslations("Design")
  const { openHome, panel, setPanel, view, setView } = useDesignWorkspace()
  const [detail, setDetail] = useState<DesignArtifactDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>("idle")

  const goBack = onBack ?? openHome
  const activeView: WorkspaceView = view === "home" ? "design" : view

  useEffect(() => {
    let current = true
    void service
      .get(artifactId)
      .then((next) => {
        if (!current) return
        setDetail(next)
        setLoading(false)
        setError(false)
      })
      .catch(() => {
        if (!current) return
        setLoading(false)
        setError(true)
      })
    return () => {
      current = false
    }
  }, [artifactId, service])

  const save = useCallback(async () => {
    if (!detail || saveState === "saving") return
    setSaveState("saving")
    try {
      const next = await service.saveRevision({
        artifactId: detail.artifact.id,
        expectedRevisionId: detail.revision.id,
        schemaVersion: detail.revision.schemaVersion,
        document: detail.revision.document,
      })
      setDetail(next)
      setSaveState("saved")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setSaveState(/conflict|revision/i.test(message) ? "conflict" : "error")
    }
  }, [detail, saveState, service])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [save])

  if (loading) {
    return <WorkspaceMessage message={t("workspace.loading")} />
  }

  if (error || !detail) {
    return (
      <WorkspaceMessage
        message={t("workspace.loadError")}
        action={t("backToDesigns")}
        onAction={goBack}
      />
    )
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("backToDesigns")}
          onClick={goBack}
        >
          <ArrowLeft />
        </Button>
        <Input
          className="h-8 w-48 border-transparent bg-transparent px-2 text-sm font-medium shadow-none focus-visible:border-border"
          value={detail.artifact.name}
          readOnly
          aria-label={t("workspace.name")}
        />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState === "saving" && t("workspace.saving")}
          {saveState === "saved" && (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3.5" aria-hidden="true" />{" "}
              {t("workspace.saved")}
            </span>
          )}
          {saveState === "conflict" && t("workspace.conflict")}
          {saveState === "error" && t("workspace.saveError")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void save()}
          >
            <Save /> {t("workspace.save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("workspace.project")}
            title={t("workspace.project")}
            disabled
          >
            <Box />
          </Button>
        </div>
      </header>

      <nav
        className="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-border/60 px-3"
        aria-label={t("workspace.views")}
      >
        {(["design", "prototype", "run"] as const).map((view) => (
          <Button
            key={view}
            type="button"
            variant={activeView === view ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={activeView === view}
            onClick={() => setView(view)}
          >
            {t(`views.${view}`)}
          </Button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 border-r border-border/60 p-3 md:block">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <PanelLeft className="size-3.5" aria-hidden="true" />
            {t("workspace.leftPanel")}
          </div>
          <div className="grid gap-1">
            {(["layers", "assets", "components", "variables"] as const).map(
              (value) => (
                <Button
                  key={value}
                  type="button"
                  variant={panel === value ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start"
                  onClick={() => setPanel(value)}
                >
                  <Layers3 /> {t(`panels.${value}`)}
                </Button>
              )
            )}
          </div>
        </aside>
        <DesignCanvasHost view={activeView} />
        <aside className="hidden w-56 shrink-0 border-l border-border/60 p-3 lg:block">
          <div className="flex items-center gap-2 text-xs font-medium">
            <PanelRight className="size-3.5" aria-hidden="true" />
            {t("workspace.rightPanel")}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("workspace.selectElement")}
          </p>
        </aside>
      </div>

      <DesignComposerHost />
      <span data-testid="design-active-view" className="sr-only">
        {activeView}
      </span>
      <span data-testid="design-active-artifact" className="sr-only">
        {detail.artifact.id}
      </span>
      <span data-testid="design-current-revision" className="sr-only">
        {detail.revision.id}
      </span>
    </main>
  )
}

function WorkspaceMessage({
  message,
  action,
  onAction,
}: {
  message: string
  action?: string
  onAction?: () => void
}) {
  return (
    <main className="grid h-full min-h-0 place-items-center bg-background p-6">
      <div className="grid max-w-sm gap-3 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        {action && onAction ? (
          <Button type="button" variant="outline" size="sm" onClick={onAction}>
            {action}
          </Button>
        ) : null}
      </div>
    </main>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  Box,
  Check,
  Layers3,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Save,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  clearDesignWorkspaceSession,
  useDesignWorkspace,
} from "@/contexts/design-workspace-context"
import type {
  DesignArtifactDetail,
  DesignArtifactService,
} from "@/lib/design/artifact-service"
import { desktopDesignArtifactService } from "@/lib/design/artifact-service"
import type { DesignDocument } from "@/lib/design/ast"
import { applyCommand } from "@/lib/design/commands"
import { normalizeDesignDocument } from "@/lib/design/document-normalizer"
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
  const {
    openHome,
    panel,
    setPanel,
    view,
    setView,
    zoom,
    setZoom,
    leftCollapsed,
    rightCollapsed,
    setLeftCollapsed,
    setRightCollapsed,
  } = useDesignWorkspace()
  const [detail, setDetail] = useState<DesignArtifactDetail | null>(null)
  const [document, setDocument] = useState<DesignDocument | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
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
        const normalized = normalizeDesignDocument(next.revision.document)
        if (!normalized.ok) {
          setLoading(false)
          setError(true)
          return
        }
        setDetail(next)
        setDocument(normalized.document)
        setSelectedNodeId(null)
        setDirty(normalized.createdFromTemplate)
        setLoading(false)
        setError(false)
      })
      .catch((cause) => {
        if (!current) return
        const message = cause instanceof Error ? cause.message : String(cause)
        if (/404|not found/i.test(message)) clearDesignWorkspaceSession()
        setLoading(false)
        setError(true)
      })
    return () => {
      current = false
    }
  }, [artifactId, service])

  const save = useCallback(async () => {
    if (!detail || !document || saveState === "saving") return
    setSaveState("saving")
    try {
      const next = await service.saveRevision({
        artifactId: detail.artifact.id,
        expectedRevisionId: detail.revision.id,
        schemaVersion: detail.revision.schemaVersion,
        document,
      })
      setDetail(next)
      setDirty(false)
      setSaveState("saved")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setSaveState(/conflict|revision/i.test(message) ? "conflict" : "error")
    }
  }, [detail, document, saveState, service])

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      if (!document) return
      const node = document.nodes.find((entry) => entry.id === id)
      if (!node?.bounds) return
      const result = applyCommand(document, {
        type: "UpdateNode",
        id,
        patch: { bounds: { ...node.bounds, x, y } },
      })
      if (!result.ok) return
      setDocument(result.document)
      setDirty(true)
      setSaveState("idle")
    },
    [document]
  )

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

  if (error || !detail || !document) {
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
          {saveState === "idle" && dirty && t("workspace.unsaved")}
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
        className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border/60 px-3"
        aria-label={t("workspace.views")}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            leftCollapsed
              ? t("workspace.showLeftPanel")
              : t("workspace.hideLeftPanel")
          }
          onClick={() => setLeftCollapsed(!leftCollapsed)}
        >
          {leftCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
        <div className="flex items-center gap-1">
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
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="justify-self-end"
          aria-label={
            rightCollapsed
              ? t("workspace.showRightPanel")
              : t("workspace.hideRightPanel")
          }
          onClick={() => setRightCollapsed(!rightCollapsed)}
        >
          {rightCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
        </Button>
      </nav>

      <div className="flex min-h-0 flex-1">
        {!leftCollapsed ? (
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
        ) : null}
        <DesignCanvasHost
          view={activeView}
          zoom={zoom}
          onZoomChange={setZoom}
          document={document}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onMoveNode={moveNode}
        />
        {!rightCollapsed ? (
          <aside className="hidden w-56 shrink-0 border-l border-border/60 p-3 lg:block">
            <div className="flex items-center gap-2 text-xs font-medium">
              <PanelRight className="size-3.5" aria-hidden="true" />
              {t("workspace.rightPanel")}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("workspace.selectElement")}
            </p>
          </aside>
        ) : null}
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

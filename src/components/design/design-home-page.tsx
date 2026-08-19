"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FilePlus2, Palette, RefreshCw, Search } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useDesignWorkspace } from "@/contexts/design-workspace-context"
import {
  filterAndSortDesignArtifacts,
  type DesignArtifact,
  type DesignArtifactFilters,
  type DesignArtifactKind,
  type DesignArtifactStatus,
} from "@/lib/design/artifact"
import {
  desktopDesignArtifactService,
  type CreateDesignArtifactInput,
  type DesignArtifactService,
} from "@/lib/design/artifact-service"
import { CreateDesignDialog } from "./create-design-dialog"
import { DesignArtifactRow } from "./design-artifact-row"

const KINDS: DesignArtifactKind[] = [
  "page",
  "component",
  "image",
  "icon",
  "design_system",
  "flow",
]
const STATUSES: DesignArtifactStatus[] = ["draft", "active", "archived"]

function emptyDocument(brief = ""): Record<string, unknown> {
  return {
    schemaVersion: 1,
    brief,
    pages: [{ id: `page-${Date.now()}`, type: "page", name: "Page 1" }],
  }
}

export function DesignHomePage({
  service = desktopDesignArtifactService,
}: {
  service?: DesignArtifactService
}) {
  const t = useTranslations("Design")
  const { artifactId, setArtifactId, setView } = useDesignWorkspace()
  const [artifacts, setArtifacts] = useState<DesignArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [filters, setFilters] = useState<DesignArtifactFilters>({
    query: "",
    kinds: [],
    statuses: [],
    project: "all",
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setArtifacts(await service.list(true))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    void load()
  }, [load])

  const visibleArtifacts = useMemo(
    () => filterAndSortDesignArtifacts(artifacts, filters),
    [artifacts, filters]
  )

  const updateArtifact = useCallback(
    async <T,>(
      id: string,
      operation: () => Promise<T>,
      apply: (value: T) => void
    ) => {
      setBusyIds((current) => new Set(current).add(id))
      try {
        const value = await operation()
        apply(value)
      } finally {
        setBusyIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      }
    },
    []
  )

  const create = async (name: string, kind: DesignArtifactKind) => {
    const input: CreateDesignArtifactInput = {
      name,
      kind,
      projectFolderId: null,
      document: emptyDocument(prompt.trim()),
    }
    const created = await service.create(input)
    setArtifacts((current) => [created, ...current])
    setCreateOpen(false)
    setPrompt("")
    setArtifactId(created.id)
    setView("design")
  }

  return (
    <main
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={t("title")}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <Palette
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{t("title")}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <FilePlus2 /> {t("newDesign")}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="h-8 pl-8"
            aria-label={t("search")}
            placeholder={t("search")}
            value={filters.query}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                query: event.target.value,
              }))
            }
          />
        </div>
        <Select
          value={filters.kinds[0] ?? "all"}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              kinds: value === "all" ? [] : [value as DesignArtifactKind],
            }))
          }
        >
          <SelectTrigger className="h-8 w-32" aria-label={t("type")}>
            <SelectValue placeholder={t("allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTypes")}</SelectItem>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.statuses[0] ?? "all"}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              statuses: value === "all" ? [] : [value as DesignArtifactStatus],
            }))
          }
        >
          <SelectTrigger className="h-8 w-32" aria-label={t("status")}>
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`statuses.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.project}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              project: value as DesignArtifactFilters["project"],
            }))
          }
        >
          <SelectTrigger className="h-8 w-32" aria-label={t("project")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allProjects")}</SelectItem>
            <SelectItem value="linked">{t("linkedProjects")}</SelectItem>
            <SelectItem value="unlinked">{t("unlinkedProjects")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {loading ? (
          <div className="grid place-items-center py-20 text-sm text-muted-foreground">
            {t("loading")}
          </div>
        ) : error ? (
          <div className="grid place-items-center gap-3 py-20 text-center">
            <p className="text-sm text-destructive">{t("loadError")}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw /> {t("retry")}
            </Button>
          </div>
        ) : visibleArtifacts.length === 0 ? (
          <div className="grid place-items-center gap-3 py-20 text-center">
            <Palette
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {filters.query || filters.kinds.length || filters.statuses.length
                ? t("noMatches")
                : t("empty")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              <FilePlus2 /> {t("newDesign")}
            </Button>
          </div>
        ) : (
          <section
            className="mx-auto max-w-4xl overflow-hidden rounded-lg border border-border/70"
            aria-label={t("recent")}
          >
            <div className="border-b border-border/60 bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
              {t("recent")}
            </div>
            {visibleArtifacts.map((item) => (
              <DesignArtifactRow
                key={item.id}
                artifact={item}
                busy={busyIds.has(item.id)}
                onOpen={() => {
                  setArtifactId(item.id)
                  setView("design")
                }}
                onRename={(name) =>
                  updateArtifact(
                    item.id,
                    () => service.rename(item.id, name),
                    (updated) =>
                      setArtifacts((current) =>
                        current.map((candidate) =>
                          candidate.id === item.id ? updated : candidate
                        )
                      )
                  )
                }
                onDuplicate={() =>
                  updateArtifact(
                    item.id,
                    () => service.duplicate(item.id),
                    (copy) => setArtifacts((current) => [copy, ...current])
                  )
                }
                onArchive={(archived) =>
                  updateArtifact(
                    item.id,
                    () => service.setArchived(item.id, archived),
                    (updated) =>
                      setArtifacts((current) =>
                        current.map((candidate) =>
                          candidate.id === item.id ? updated : candidate
                        )
                      )
                  )
                }
                onDelete={() =>
                  updateArtifact(
                    item.id,
                    () => service.delete(item.id),
                    () =>
                      setArtifacts((current) =>
                        current.filter((candidate) => candidate.id !== item.id)
                      )
                  )
                }
              />
            ))}
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 px-4 py-2">
        <form
          className="mx-auto flex max-w-4xl gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const name = prompt.trim()
            if (name) setCreateOpen(true)
          }}
        >
          <Input
            aria-label={t("brief")}
            placeholder={t("brief")}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!prompt.trim()}>
            {t("startFromBrief")}
          </Button>
        </form>
      </div>

      <CreateDesignDialog
        open={createOpen}
        busy={false}
        initialName={prompt.trim()}
        onOpenChange={setCreateOpen}
        onCreate={create}
      />
      <span data-testid="active-design-artifact" className="sr-only">
        {artifactId ?? ""}
      </span>
    </main>
  )
}

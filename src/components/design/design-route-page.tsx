"use client"

import { useTranslations } from "next-intl"

import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import { useDesignWorkspace } from "@/contexts/design-workspace-context"
import { DesignHomePage } from "./design-home-page"

export function DesignRoutePageTitle() {
  const t = useTranslations("Folder.sidebar")
  return <WorkbenchPageTitle title={t("design")} />
}

export function DesignRoutePage() {
  const { artifactId } = useDesignWorkspace()
  return artifactId ? (
    <main
      className="h-full min-h-0 bg-background"
      data-design-workspace="true"
    />
  ) : (
    <DesignHomePage />
  )
}

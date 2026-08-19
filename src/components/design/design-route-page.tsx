"use client"

import { useTranslations } from "next-intl"

import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import { useDesignWorkspace } from "@/contexts/design-workspace-context"
import { desktopDesignArtifactService } from "@/lib/design/artifact-service"
import { DesignHomePage } from "./design-home-page"
import { DesignWorkspace } from "./design-workspace"

export function DesignRoutePageTitle() {
  const t = useTranslations("Folder.sidebar")
  return <WorkbenchPageTitle title={t("design")} />
}

export function DesignRoutePage() {
  const { artifactId, openHome } = useDesignWorkspace()
  return artifactId ? (
    <DesignWorkspace
      artifactId={artifactId}
      service={desktopDesignArtifactService}
      onBack={openHome}
    />
  ) : (
    <DesignHomePage />
  )
}

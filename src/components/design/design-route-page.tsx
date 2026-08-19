"use client"

import { useTranslations } from "next-intl"

import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"

export function DesignRoutePageTitle() {
  const t = useTranslations("Folder.sidebar")
  return <WorkbenchPageTitle title={t("design")} />
}

export function DesignRoutePage() {
  const t = useTranslations("Folder.sidebar")
  return (
    <main className="h-full min-h-0 bg-background" aria-label={t("design")} />
  )
}

"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DesignBounds, DesignNode } from "@/lib/design/ast"
import type { Command } from "@/lib/design/commands"

type BoundsField = keyof DesignBounds
type Drafts = Record<BoundsField | "opacity" | "text", string>

export function DesignPropertiesPanel({
  node,
  onUpdate,
}: {
  node: DesignNode | null
  onUpdate: (command: Command) => void
}) {
  const t = useTranslations("Design")

  if (!node) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        {t("workspace.selectElement")}
      </p>
    )
  }

  return (
    <DesignPropertiesEditor
      key={draftKey(node)}
      node={node}
      onUpdate={onUpdate}
    />
  )
}

function DesignPropertiesEditor({
  node,
  onUpdate,
}: {
  node: DesignNode
  onUpdate: (command: Command) => void
}) {
  const t = useTranslations("Design")
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFor(node))
  const [errors, setErrors] = useState<Partial<Record<keyof Drafts, string>>>(
    {}
  )

  const bounds = node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }

  const commitBounds = (field: BoundsField) => {
    const value = Number(drafts[field])
    if (!Number.isFinite(value)) {
      setErrors((current) => ({
        ...current,
        [field]: t("properties.invalidNumber"),
      }))
      return
    }
    if ((field === "width" || field === "height") && value < 0) {
      setErrors((current) => ({
        ...current,
        [field]: t("properties.nonNegative", {
          field: t(`properties.fields.${field}`),
        }),
      }))
      return
    }
    setErrors((current) => ({ ...current, [field]: undefined }))
    if (value === bounds[field]) return
    onUpdate({
      type: "UpdateNode",
      id: node.id,
      patch: { bounds: { ...bounds, [field]: value } },
    })
  }

  const commitOpacity = () => {
    const value = Number(drafts.opacity)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setErrors((current) => ({
        ...current,
        opacity: t("properties.opacityRange"),
      }))
      return
    }
    setErrors((current) => ({ ...current, opacity: undefined }))
    const opacity = value / 100
    if (opacity === (node.opacity ?? 1)) return
    onUpdate({
      type: "UpdateNode",
      id: node.id,
      patch: { opacity },
    })
  }

  const commitText = () => {
    if (node.type !== "text" || drafts.text === (node.text ?? "")) return
    onUpdate({ type: "SetText", id: node.id, text: drafts.text })
  }

  return (
    <div className="mt-3 grid gap-4" data-testid="design-properties-panel">
      <div className="grid gap-1 border-b border-border/60 pb-3">
        <span className="text-sm font-medium">
          {t(`properties.nodeTypes.${node.type}`)}
        </span>
        <code className="break-all text-xs text-muted-foreground">
          {node.id}
        </code>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["x", "y", "width", "height"] as const).map((field) => (
          <NumericProperty
            key={field}
            id={`design-property-${field}`}
            label={t(`properties.fields.${field}`)}
            value={drafts[field]}
            error={errors[field]}
            onChange={(value) =>
              setDrafts((current) => ({ ...current, [field]: value }))
            }
            onCommit={() => commitBounds(field)}
          />
        ))}
      </div>

      <NumericProperty
        id="design-property-opacity"
        label={t("properties.fields.opacity")}
        value={drafts.opacity}
        error={errors.opacity}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) =>
          setDrafts((current) => ({ ...current, opacity: value }))
        }
        onCommit={commitOpacity}
      />

      {node.type === "text" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="design-property-text">
            {t("properties.fields.text")}
          </Label>
          <Textarea
            id="design-property-text"
            value={drafts.text}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                text: event.target.value,
              }))
            }
            onBlur={commitText}
          />
        </div>
      ) : null}
    </div>
  )
}

function NumericProperty({
  id,
  label,
  value,
  error,
  min,
  max,
  suffix,
  onChange,
  onCommit,
}: {
  id: string
  label: string
  value: string
  error?: string
  min?: number
  max?: number
  suffix?: string
  onChange: (value: string) => void
  onCommit: () => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          className={suffix ? "pr-8" : undefined}
          value={value}
          min={min}
          max={max}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit()
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function draftsFor(node: DesignNode | null): Drafts {
  const bounds = node?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: String(bounds.x),
    y: String(bounds.y),
    width: String(bounds.width),
    height: String(bounds.height),
    opacity: String(Math.round((node?.opacity ?? 1) * 100)),
    text: node?.text ?? "",
  }
}

function draftKey(node: DesignNode): string {
  const bounds = node.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  return [
    node.id,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    node.opacity ?? 1,
    node.text ?? "",
  ].join(":")
}

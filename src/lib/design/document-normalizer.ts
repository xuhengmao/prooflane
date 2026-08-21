import {
  validateDesignDocument,
  type DesignBounds,
  type DesignDocument,
  type DesignNode,
} from "./ast"
import { revisionOf } from "./commands"

export type NormalizeDesignDocumentResult =
  | {
      ok: true
      document: DesignDocument
      createdFromTemplate: boolean
    }
  | { ok: false; errors: string[] }

const DESIGN_NODE_TYPES = new Set([
  "document",
  "page",
  "group",
  "frame",
  "rectangle",
  "shape",
  "text",
  "image",
])

const STARTER_NODES: DesignNode[] = [
  {
    id: "root-frame",
    type: "frame",
    children: ["background-rectangle", "title-text"],
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    style: { fill: "#ffffff" },
    metadata: { name: "Desktop" },
  },
  {
    id: "background-rectangle",
    type: "rectangle",
    parentId: "root-frame",
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    style: { fill: "#ffffff" },
    metadata: { name: "Background" },
  },
  {
    id: "title-text",
    type: "text",
    parentId: "root-frame",
    bounds: { x: 96, y: 96, width: 520, height: 72 },
    text: "Hello，Prooflane",
    style: {
      fill: "#111827",
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: 600,
    },
    metadata: { name: "Title" },
  },
]

export function createBlankDesignDocument(): DesignDocument {
  const base: DesignDocument = {
    version: 1,
    revision: "",
    rootId: "root-frame",
    nodes: STARTER_NODES.map((node) => structuredClone(node)).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
  }
  return { ...base, revision: revisionOf(base) }
}

export function normalizeDesignDocument(
  input: unknown
): NormalizeDesignDocumentResult {
  if (isLegacyPlaceholder(input)) {
    return {
      ok: true,
      document: createBlankDesignDocument(),
      createdFromTemplate: true,
    }
  }
  if (!isDesignDocument(input)) {
    return { ok: false, errors: ["invalid_design_document"] }
  }
  if (input.nodes.length === 0) {
    return {
      ok: true,
      document: createBlankDesignDocument(),
      createdFromTemplate: true,
    }
  }
  const invalidBounds = input.nodes.find(
    (node) => node.bounds !== undefined && !isValidBounds(node.bounds)
  )
  if (invalidBounds) {
    return { ok: false, errors: [`invalid_bounds:${invalidBounds.id}`] }
  }
  const validation = validateDesignDocument(input)
  if (!validation.ok || !validation.document) {
    return {
      ok: false,
      errors: validation.errors.map((error) => error.code),
    }
  }
  return {
    ok: true,
    document: validation.document,
    createdFromTemplate: false,
  }
}

function isLegacyPlaceholder(input: unknown): boolean {
  if (!isRecord(input) || input.schemaVersion !== 1) return false
  const keys = Object.keys(input)
  if (keys.some((key) => !["schemaVersion", "brief", "pages"].includes(key)))
    return false
  if (input.brief !== undefined && typeof input.brief !== "string") return false
  if (input.pages === undefined) return true
  if (!Array.isArray(input.pages)) return false
  return input.pages.every(
    (page) =>
      isRecord(page) &&
      page.type === "page" &&
      typeof page.id === "string" &&
      page.id.length > 0
  )
}

function isDesignDocument(input: unknown): input is DesignDocument {
  if (!isRecord(input)) return false
  if (input.version !== 1 || typeof input.revision !== "string") return false
  if (input.rootId !== undefined && typeof input.rootId !== "string")
    return false
  if (!Array.isArray(input.nodes)) return false
  return input.nodes.every(
    (node) =>
      isRecord(node) &&
      typeof node.id === "string" &&
      typeof node.type === "string" &&
      DESIGN_NODE_TYPES.has(node.type)
  )
}

function isValidBounds(bounds: DesignBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 0 &&
    bounds.height >= 0
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

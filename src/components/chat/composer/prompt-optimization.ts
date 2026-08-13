import type { JSONContent } from "@tiptap/core"
import { optimizePrompt } from "@/lib/api"

export interface PromptOptimizationHistoryItem {
  role: "user" | "assistant" | "system"
  text: string
}

export interface PromptOptimizationContext {
  workspacePath?: string
  conversationHistory: PromptOptimizationHistoryItem[]
  relatedFiles: string[]
}

export interface PromptOptimizationRequest {
  text: string
  context: PromptOptimizationContext
}

export interface PromptOptimizationProvider {
  optimize(
    request: PromptOptimizationRequest,
    signal: AbortSignal
  ): Promise<string>
}

export interface PromptOptimizationResult {
  document: JSONContent
  beforeCharacters: number
  afterCharacters: number
}

export const PROMPT_OPTIMIZATION_TIMEOUT_MS = 120_000
export const PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS = 65_536

export type PromptOptimizationErrorCode =
  | "aborted"
  | "empty_output"
  | "invalid_output"
  | "timeout"
  | "output_too_long"

export class PromptOptimizationError extends Error {
  constructor(
    readonly code: PromptOptimizationErrorCode,
    message: string
  ) {
    super(message)
    this.name = "PromptOptimizationError"
  }
}

const STRUCTURAL_NODE_TYPES = new Set([
  "codeBlock",
  "code_block",
  "reference",
  "image",
  "resource",
  "resourceLink",
])

export class AgentPromptOptimizationProvider implements PromptOptimizationProvider {
  async optimize(
    request: PromptOptimizationRequest,
    signal: AbortSignal
  ): Promise<string> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")

    return optimizePrompt(
      {
        workingDir: request.context.workspacePath ?? null,
        draft: request.text,
        conversationHistory: request.context.conversationHistory,
        relatedFiles: request.context.relatedFiles,
      },
      signal
    )
  }
}

function isProtectedNode(node: JSONContent, protectedAncestor: boolean) {
  return protectedAncestor || STRUCTURAL_NODE_TYPES.has(node.type ?? "")
}

function editableText(node: JSONContent, protectedAncestor = false): string {
  const protectedNode = isProtectedNode(node, protectedAncestor)
  if (protectedNode) return ""
  if (node.type === "text") return node.text ?? ""
  if (node.type === "hardBreak") return "\n"
  if (!node.content) return ""
  return node.content
    .map((child) => editableText(child, protectedNode))
    .join("")
}

interface ProtectedPlaceholder {
  token: string
  node: JSONContent
}

interface EditableSegment {
  placeholders: ProtectedPlaceholder[]
}

interface SerializedDocument {
  text: string
  editableSegments: EditableSegment[]
}

function segmentStart(index: number) {
  return `{{PROOFLANE_SEGMENT_${index}_START}}`
}

function segmentEnd(index: number) {
  return `{{PROOFLANE_SEGMENT_${index}_END}}`
}

function serializeEditableNode(
  node: JSONContent,
  placeholders: ProtectedPlaceholder[]
): string {
  if (STRUCTURAL_NODE_TYPES.has(node.type ?? "")) {
    const placeholder = {
      token: `{{PROOFLANE_PROTECTED_${placeholders.length}}}`,
      node: structuredClone(node),
    }
    placeholders.push(placeholder)
    return placeholder.token
  }
  if (node.type === "text") return node.text ?? ""
  if (node.type === "hardBreak") return "\n"
  return (node.content ?? [])
    .map((child) => serializeEditableNode(child, placeholders))
    .join("")
}

function serializeDocument(document: JSONContent): SerializedDocument {
  const placeholders: ProtectedPlaceholder[] = []
  const editableSegments: EditableSegment[] = []
  const segments: string[] = []

  for (const node of document.content ?? []) {
    if (
      STRUCTURAL_NODE_TYPES.has(node.type ?? "") ||
      !editableText(node).trim()
    ) {
      continue
    }
    const firstPlaceholder = placeholders.length
    const body = serializeEditableNode(node, placeholders).trim()
    const index = editableSegments.length
    editableSegments.push({
      placeholders: placeholders.slice(firstPlaceholder),
    })
    segments.push(`${segmentStart(index)}\n${body}\n${segmentEnd(index)}`)
  }

  return { text: segments.join("\n"), editableSegments }
}

function invalidOptimizationOutput(): never {
  throw new PromptOptimizationError(
    "invalid_output",
    "Prompt optimization returned an invalid document structure"
  )
}

function parseOptimizedSegments(text: string, expectedCount: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  const segments: string[] = []
  let cursor = 0

  for (let index = 0; index < expectedCount; index += 1) {
    const start = segmentStart(index)
    const end = segmentEnd(index)
    if (!normalized.startsWith(start, cursor)) invalidOptimizationOutput()
    cursor += start.length
    if (normalized[cursor] !== "\n") invalidOptimizationOutput()
    cursor += 1

    const endDelimiter = `\n${end}`
    const endIndex = normalized.indexOf(endDelimiter, cursor)
    if (endIndex < 0) invalidOptimizationOutput()
    const body = normalized.slice(cursor, endIndex).trim()
    if (!body || /\{\{PROOFLANE_SEGMENT_\d+_(?:START|END)\}\}/.test(body)) {
      invalidOptimizationOutput()
    }
    segments.push(body)
    cursor = endIndex + endDelimiter.length

    if (index < expectedCount - 1) {
      if (normalized[cursor] !== "\n") invalidOptimizationOutput()
      cursor += 1
    }
  }

  if (cursor !== normalized.length) invalidOptimizationOutput()
  return segments
}

function splitOptimizedSegment(
  text: string,
  placeholders: ProtectedPlaceholder[]
): JSONContent[] | null {
  const placeholderByToken = new Map(
    placeholders.map((placeholder) => [placeholder.token, placeholder.node])
  )
  const tokenPattern = /\{\{PROOFLANE_PROTECTED_\d+\}\}/g
  const found = text.match(tokenPattern) ?? []
  if (
    found.length !== placeholders.length ||
    new Set(found).size !== placeholders.length ||
    found.some((token, index) => token !== placeholders[index]?.token)
  ) {
    return null
  }

  const content: JSONContent[] = []
  const appendText = (value: string) => {
    value.split("\n").forEach((line, index) => {
      if (index > 0) content.push({ type: "hardBreak" })
      if (line) content.push({ type: "text", text: line })
    })
  }
  let cursor = 0
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    if (index > cursor) appendText(text.slice(cursor, index))
    content.push(structuredClone(placeholderByToken.get(match[0])!))
    cursor = index + match[0].length
  }
  if (cursor < text.length) appendText(text.slice(cursor))
  return content.length > 0 ? content : null
}

function optimizedDocument(
  document: JSONContent,
  optimizedText: string,
  editableSegments: EditableSegment[]
): JSONContent {
  const optimizedSegments = parseOptimizedSegments(
    optimizedText,
    editableSegments.length
  )
  let segmentIndex = 0
  const content = (document.content ?? []).map((node) => {
    if (STRUCTURAL_NODE_TYPES.has(node.type ?? "")) {
      return structuredClone(node)
    }

    const hasEditableText = editableText(node).trim().length > 0
    if (!hasEditableText) return structuredClone(node)

    const layout = editableSegments[segmentIndex]
    const optimizedSegment = optimizedSegments[segmentIndex]
    segmentIndex += 1
    if (!optimizedSegment || !layout) invalidOptimizationOutput()
    const optimizedContent = splitOptimizedSegment(
      optimizedSegment,
      layout.placeholders
    )
    if (!optimizedContent) invalidOptimizationOutput()
    return { ...structuredClone(node), content: optimizedContent }
  })

  if (segmentIndex !== editableSegments.length) invalidOptimizationOutput()
  return { ...structuredClone(document), content }
}

export function editablePromptCharacterCount(
  node: JSONContent,
  protectedAncestor = false
): number {
  const protectedNode = isProtectedNode(node, protectedAncestor)
  if (node.type === "text" && !protectedNode) return node.text?.length ?? 0
  if (!node.content || protectedNode) return 0
  return node.content.reduce(
    (total, child) =>
      total + editablePromptCharacterCount(child, protectedNode),
    0
  )
}

export function hasEditablePromptText(
  node: JSONContent,
  protectedAncestor = false
): boolean {
  const protectedNode = isProtectedNode(node, protectedAncestor)
  if (node.type === "text" && !protectedNode) return Boolean(node.text?.trim())
  if (!node.content || protectedNode) return false
  return node.content.some((child) =>
    hasEditablePromptText(child, protectedNode)
  )
}

function relatedFilesFromDocument(
  node: JSONContent,
  files = new Set<string>()
): string[] {
  if (node.type === "reference" || node.type === "resourceLink") {
    const uri = node.attrs?.uri
    if (typeof uri === "string" && uri.trim()) files.add(uri)
  }
  for (const child of node.content ?? []) relatedFilesFromDocument(child, files)
  return [...files]
}

async function optimizeWithDeadline(
  request: PromptOptimizationRequest,
  provider: PromptOptimizationProvider,
  signal: AbortSignal
): Promise<string> {
  if (signal.aborted) {
    throw new PromptOptimizationError("aborted", "Prompt optimization aborted")
  }

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal.reason)
  signal.addEventListener("abort", abortFromCaller, { once: true })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort("timeout")
      reject(
        new PromptOptimizationError(
          "timeout",
          `Prompt optimization timed out after ${PROMPT_OPTIMIZATION_TIMEOUT_MS}ms`
        )
      )
    }, PROMPT_OPTIMIZATION_TIMEOUT_MS)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        if (controller.signal.reason === "timeout") return
        reject(
          new PromptOptimizationError("aborted", "Prompt optimization aborted")
        )
      },
      { once: true }
    )
  })

  try {
    return await Promise.race([
      provider.optimize(request, controller.signal),
      timeout,
      aborted,
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal.removeEventListener("abort", abortFromCaller)
  }
}

export async function optimizeComposerDocument(
  document: JSONContent,
  provider: PromptOptimizationProvider,
  context: PromptOptimizationContext,
  signal = new AbortController().signal
): Promise<PromptOptimizationResult> {
  const serialized = serializeDocument(document)
  const beforeCharacters = editablePromptCharacterCount(document)
  const relatedFiles = [
    ...new Set([
      ...context.relatedFiles,
      ...relatedFilesFromDocument(document),
    ]),
  ]
  const optimizedText = await optimizeWithDeadline(
    { text: serialized.text, context: { ...context, relatedFiles } },
    provider,
    signal
  )
  if (!optimizedText.trim()) {
    throw new PromptOptimizationError(
      "empty_output",
      "Prompt optimization returned empty text"
    )
  }
  if (optimizedText.length > PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS) {
    throw new PromptOptimizationError(
      "output_too_long",
      `Optimized prompt exceeds ${PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS} characters`
    )
  }

  const optimized = optimizedDocument(
    document,
    optimizedText,
    serialized.editableSegments
  )
  return {
    document: optimized,
    beforeCharacters,
    afterCharacters: editablePromptCharacterCount(optimized),
  }
}

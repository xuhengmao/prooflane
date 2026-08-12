import type { JSONContent } from "@tiptap/core"

export interface PromptOptimizationProvider {
  optimize(text: string, signal: AbortSignal): Promise<string>
}

export interface PromptOptimizationResult {
  document: JSONContent
  beforeCharacters: number
  afterCharacters: number
}

export const PROMPT_OPTIMIZATION_TIMEOUT_MS = 20_000
export const PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS = 65_536

export type PromptOptimizationErrorCode =
  | "aborted"
  | "empty_output"
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

function compactPrompt(text: string): string {
  return text
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/请你帮我(?:\s+帮我)?/g, "请")
    .replace(/帮我(?:\s+帮我)?/g, "")
    .replace(/分析一下/g, "分析")
    .replace(/看一下/g, "查看")
    .replace(/这个问题/g, "这个问题")
    .trim()
}

function preserveEdgeWhitespace(original: string, optimized: string): string {
  let result = optimized
  if (/^\s/.test(original) && !/^\s/.test(result)) {
    result = `${original.startsWith("\n") ? "\n" : " "}${result}`
  }
  if (/\s$/.test(original) && !/\s$/.test(result)) {
    result = `${result}${original.endsWith("\n") ? "\n" : " "}`
  }
  return result
}

export class LocalPromptOptimizationProvider implements PromptOptimizationProvider {
  async optimize(text: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return compactPrompt(text)
  }
}

async function optimizeNode(
  node: JSONContent,
  provider: PromptOptimizationProvider,
  signal: AbortSignal,
  protectedAncestor = false
): Promise<JSONContent> {
  const protectedNode =
    protectedAncestor || STRUCTURAL_NODE_TYPES.has(node.type ?? "")

  if (node.type === "text" && typeof node.text === "string" && !protectedNode) {
    if (!node.text.trim()) return structuredClone(node)
    const optimized = await provider.optimize(node.text, signal)
    if (!optimized.trim()) {
      throw new PromptOptimizationError(
        "empty_output",
        "Prompt optimization returned empty text"
      )
    }
    return { ...node, text: preserveEdgeWhitespace(node.text, optimized) }
  }

  if (!node.content || protectedNode) return structuredClone(node)

  return {
    ...node,
    content: await Promise.all(
      node.content.map((child) =>
        optimizeNode(child, provider, signal, protectedNode)
      )
    ),
  }
}

export function editablePromptCharacterCount(
  node: JSONContent,
  protectedAncestor = false
): number {
  const protectedNode =
    protectedAncestor || STRUCTURAL_NODE_TYPES.has(node.type ?? "")
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
  const protectedNode =
    protectedAncestor || STRUCTURAL_NODE_TYPES.has(node.type ?? "")
  if (node.type === "text" && !protectedNode) {
    return Boolean(node.text?.trim())
  }
  if (!node.content || protectedNode) return false
  return node.content.some((child) =>
    hasEditablePromptText(child, protectedNode)
  )
}

async function optimizeWithDeadline(
  document: JSONContent,
  provider: PromptOptimizationProvider,
  signal: AbortSignal
): Promise<JSONContent> {
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
      optimizeNode(document, provider, controller.signal),
      timeout,
      aborted,
    ])
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal.removeEventListener("abort", abortFromCaller)
  }
}

export async function optimizeComposerDocument(
  document: JSONContent,
  provider: PromptOptimizationProvider,
  signal = new AbortController().signal
): Promise<PromptOptimizationResult> {
  const beforeCharacters = editablePromptCharacterCount(document)
  const optimized = await optimizeWithDeadline(document, provider, signal)
  const afterCharacters = editablePromptCharacterCount(optimized)

  if (afterCharacters > PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS) {
    throw new PromptOptimizationError(
      "output_too_long",
      `Optimized prompt exceeds ${PROMPT_OPTIMIZATION_MAX_OUTPUT_CHARACTERS} characters`
    )
  }

  return {
    document: optimized,
    beforeCharacters,
    afterCharacters,
  }
}

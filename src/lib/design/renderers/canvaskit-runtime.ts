import type { CanvasKit, CanvasKitInitOptions } from "canvaskit-wasm"

export type CanvasKitRuntime = Pick<
  CanvasKit,
  | "Color"
  | "Font"
  | "MakeCanvasSurface"
  | "Paint"
  | "PaintStyle"
  | "XYWHRect"
  | "parseColorString"
>

export type CanvasKitInitializer = (
  options: CanvasKitInitOptions
) => Promise<CanvasKitRuntime>

const CANVASKIT_SCRIPT_SRC = "/canvaskit/canvaskit.js"

type CanvasKitWindow = typeof window & {
  CanvasKitInit?: CanvasKitInitializer
}

function loadBrowserInitializer(): Promise<CanvasKitInitializer> {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(new Error("CanvasKit 只能在浏览器环境初始化"))
  const browserWindow = window as CanvasKitWindow
  if (browserWindow.CanvasKitInit)
    return Promise.resolve(browserWindow.CanvasKitInit)

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CANVASKIT_SCRIPT_SRC}"]`
    )
    const script = existing ?? document.createElement("script")
    const cleanup = () => {
      script.removeEventListener("load", handleLoad)
      script.removeEventListener("error", handleError)
    }
    const handleLoad = () => {
      cleanup()
      if (browserWindow.CanvasKitInit) resolve(browserWindow.CanvasKitInit)
      else reject(new Error("本地 CanvasKit 脚本未暴露初始化函数"))
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`无法加载本地脚本 ${CANVASKIT_SCRIPT_SRC}`))
    }
    script.addEventListener("load", handleLoad)
    script.addEventListener("error", handleError)
    if (!existing) {
      script.src = CANVASKIT_SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
}

const initializeCanvasKit: CanvasKitInitializer = async (options) => {
  const initializer = await loadBrowserInitializer()
  return initializer(options)
}
let runtimePromise: Promise<CanvasKitRuntime> | undefined

function initialize(initializer: CanvasKitInitializer) {
  return initializer({
    locateFile: (file) => `/canvaskit/${file}`,
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`CanvasKit WASM 初始化失败：${detail}`)
  })
}

export function loadCanvasKitRuntime(
  initializer: CanvasKitInitializer = initializeCanvasKit
): Promise<CanvasKitRuntime> {
  if (initializer !== initializeCanvasKit) return initialize(initializer)
  runtimePromise ??= initialize(initializer).catch((error: unknown) => {
    runtimePromise = undefined
    throw error
  })
  return runtimePromise
}

import type { DesignDocument } from "./ast"

export interface DesignPackageManifest {
  formatVersion: 1
  designId: string
  astSha256: string
  assetRefs: string[]
}

export interface PackageValidationResult {
  ok: boolean
  errors: string[]
}

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const rightRotate = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits))

/** Synchronous SHA-256 for browser-safe manifest validation. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32))

  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]
  const schedule = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      schedule[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15]
      const y = schedule[index - 2]
      const sigma0 = rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3)
      const sigma1 = rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10)
      schedule[index] =
        (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = state
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 =
        (h +
          sum1 +
          choose +
          SHA256_ROUND_CONSTANTS[index] +
          schedule[index]) >>>
        0
      const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    state[0] = (state[0] + a) >>> 0
    state[1] = (state[1] + b) >>> 0
    state[2] = (state[2] + c) >>> 0
    state[3] = (state[3] + d) >>> 0
    state[4] = (state[4] + e) >>> 0
    state[5] = (state[5] + f) >>> 0
    state[6] = (state[6] + g) >>> 0
    state[7] = (state[7] + h) >>> 0
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("")
}

const astBytes = (
  ast: DesignDocument | string | Uint8Array
): string | Uint8Array =>
  typeof ast === "string" || ast instanceof Uint8Array
    ? ast
    : JSON.stringify(ast)

const isEscapingAssetPath = (assetRef: string): boolean => {
  if (!assetRef || assetRef.includes("\0")) return true
  const normalized = assetRef.replaceAll("\\", "/")
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return true
  const parts = normalized.split("/")
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") return true
  }
  return false
}

export function validatePackageManifest(
  manifest: DesignPackageManifest,
  ast: DesignDocument | string | Uint8Array
): PackageValidationResult {
  const errors: string[] = []
  if (manifest.formatVersion !== 1) errors.push("unsupported_format_version")
  if (!manifest.designId.trim()) errors.push("missing_design_id")
  if (!/^[a-fA-F0-9]{64}$/.test(manifest.astSha256))
    errors.push("invalid_ast_hash")
  else if (manifest.astSha256.toLowerCase() !== sha256Hex(astBytes(ast)))
    errors.push("ast_hash_mismatch")
  if (manifest.assetRefs.some(isEscapingAssetPath))
    errors.push("asset_path_escape")
  if (
    typeof ast === "object" &&
    !(ast instanceof Uint8Array) &&
    ast.version !== 1
  )
    errors.push("unsupported_ast_version")
  return { ok: errors.length === 0, errors }
}

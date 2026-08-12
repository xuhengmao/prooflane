import { appendFileSync } from "node:fs"

const updaterSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
]
const appleSecrets = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
]

const isConfigured = (name) => Boolean(process.env[name]?.trim())
const missingUpdaterSecrets = updaterSecrets.filter(
  (name) => !isConfigured(name)
)

if (missingUpdaterSecrets.length > 0) {
  console.error(
    `Missing required release secret(s): ${missingUpdaterSecrets.join(", ")}`
  )
  process.exit(1)
}

const prerelease = process.env.RELEASE_PRERELEASE === "true"
const configuredAppleSecrets = appleSecrets.filter(isConfigured)
const missingAppleSecrets = appleSecrets.filter((name) => !isConfigured(name))

if (!prerelease && missingAppleSecrets.length > 0) {
  console.error(
    `Missing required release secret(s): ${missingAppleSecrets.join(", ")}`
  )
  process.exit(1)
}

if (
  prerelease &&
  configuredAppleSecrets.length > 0 &&
  missingAppleSecrets.length > 0
) {
  console.error(
    `Apple signing is partially configured; missing required release secret(s): ${missingAppleSecrets.join(", ")}`
  )
  process.exit(1)
}

const appleSigningEnabled = missingAppleSecrets.length === 0
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `apple_signing_enabled=${appleSigningEnabled}\n`,
    "utf8"
  )
}

if (appleSigningEnabled) {
  console.log("Release signing secrets are configured")
} else {
  console.log(
    "Updater signing is configured; Apple signing is disabled for this prerelease"
  )
}

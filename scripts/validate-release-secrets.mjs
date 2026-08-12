const requiredSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
]

const missing = requiredSecrets.filter(
  (name) => !process.env[name] || !process.env[name].trim()
)

if (missing.length > 0) {
  console.error(`Missing required release secret(s): ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Release signing secrets are configured")

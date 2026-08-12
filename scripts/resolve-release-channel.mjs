import { appendFileSync } from "node:fs"

const tag = process.argv[2] ?? ""
const numericIdentifier = "(?:0|[1-9]\\d*)"
const stableTag = new RegExp(
  `^v${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}$`
)
const releaseCandidateTag = new RegExp(
  `^v${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}-rc\\.${numericIdentifier}$`
)

let prerelease
if (stableTag.test(tag)) {
  prerelease = false
} else if (releaseCandidateTag.test(tag)) {
  prerelease = true
} else {
  console.error(
    `Unsupported release tag ${JSON.stringify(tag)}; expected vX.Y.Z or vX.Y.Z-rc.N`
  )
  process.exit(1)
}

if (!process.env.GITHUB_OUTPUT) {
  console.error("GITHUB_OUTPUT is required to resolve the release channel")
  process.exit(1)
}

appendFileSync(process.env.GITHUB_OUTPUT, `prerelease=${prerelease}\n`, "utf8")
console.log(`${tag} resolved as ${prerelease ? "prerelease" : "stable"}`)

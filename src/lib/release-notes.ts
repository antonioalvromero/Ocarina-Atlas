export interface CommitEntry {
  sha: string
  subject: string
  author?: string
}

export interface GroupedCommits {
  features: CommitEntry[]
  fixes: CommitEntry[]
  docsAndCi: CommitEntry[]
  other: CommitEntry[]
}

export interface LichiiGroupedCommits {
  newFeatures: CommitEntry[]
  bugFixes: CommitEntry[]
  telemetryAndMap: CommitEntry[]
  windowsLauncher: CommitEntry[]
  stabilityDocsCi: CommitEntry[]
}

export interface ReleasePromptContext {
  version: string
  previousTag: string | null
  instructions: string
  commits: readonly CommitEntry[]
  changelogSection: string
  githubGeneratedNotes: string
}

export interface ComposeReleaseBodyInput {
  version: string
  previousTag: string | null
  repoSlug: string
  headBranch?: string | null
  headSha?: string | null
  previousTagSha?: string | null
  changeCount?: number
  leadSummary?: string | null
  aiSummary: string | null
  aiProviderLabel: string | null
  changelogSection: string
  commits: readonly CommitEntry[]
  githubGeneratedNotes: string
  zipAssetName: string
  zipSha256: string | null
}

const REPO_SLUG_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SAFE_GIT_REF_REGEX = /^[A-Za-z0-9._/+-]+$/
const SAFE_MODEL_REGEX = /^[A-Za-z0-9._:-]+$/

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|perf|refactor|docs|ci|build|chore|test|style|security)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function capitalizeFirst(text: string): string {
  if (!text) return ''
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function formatScopeLabel(scope: string): string {
  const cleaned = scope.trim()
  if (!cleaned) return ''
  const upperMap: Record<string, string> = {
    ci: 'CI',
    ui: 'UI',
    rpc: 'RPC',
    pwa: 'PWA',
    ssr: 'SSR',
    aslr: 'ASLR',
    'hyrule-atlas': 'Hyrule Atlas',
  }
  const lower = cleaned.toLowerCase()
  if (upperMap[lower]) return upperMap[lower]
  return cleaned
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => capitalizeFirst(part))
    .join(' ')
}

/**
 * Validates and normalizes an `owner/repo` slug, returning `null` if unsafe or malformed.
 */
export function parseSafeRepoSlug(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('..') || !REPO_SLUG_REGEX.test(trimmed)) {
    return null
  }
  return trimmed
}

/**
 * Validates a repository slug before interpolating into GitHub API or release URLs.
 */
export function validateRepoSlug(value: string): string {
  const parsed = parseSafeRepoSlug(value)
  if (!parsed) {
    throw new Error('Invalid GitHub repository slug; expected owner/repo.')
  }
  return parsed
}

/**
 * Extracts a safe `owner/repo` slug from an HTTPS or SSH GitHub remote URL.
 */
export function extractGitHubRepoSlugFromRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i)
  if (httpsMatch?.[1]) {
    return parseSafeRepoSlug(httpsMatch[1])
  }
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i)
  if (sshMatch?.[1]) {
    return parseSafeRepoSlug(sshMatch[1])
  }
  return null
}

/**
 * Checks that a git ref/tag name contains only safe characters and cannot act as a CLI flag.
 */
export function isSafeGitRef(value: string): boolean {
  const trimmed = value.trim()
  if (
    !trimmed ||
    trimmed.startsWith('-') ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    trimmed.includes('\\') ||
    /[\x00-\x1f\x7f\s]/.test(trimmed)
  ) {
    return false
  }
  return SAFE_GIT_REF_REGEX.test(trimmed)
}

/**
 * Validates a git ref/tag name before passing it to git CLI arguments.
 */
export function validateGitRef(value: string, label = 'git ref'): string {
  const trimmed = value.trim()
  if (!isSafeGitRef(trimmed)) {
    throw new Error(`Unsafe or invalid ${label}.`)
  }
  return trimmed
}

/**
 * Validates an AI model identifier before interpolating it into an API endpoint path.
 */
export function validateModelName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-') || trimmed.includes('..') || !SAFE_MODEL_REGEX.test(trimmed)) {
    throw new Error('Invalid AI model identifier.')
  }
  return trimmed
}

/**
 * Redacts explicit secret values (raw and URL-encoded), query credentials, auth headers,
 * and common API token patterns from error messages and logs.
 */
export function sanitizeSecretText(input: unknown, secrets: readonly string[] = []): string {
  let rawText = ''
  if (input instanceof Error) {
    const base = input.message ? `${input.name || 'Error'}: ${input.message}` : input.name || 'Error'
    const causeObj =
      input.cause && typeof input.cause === 'object' && 'code' in input.cause
        ? (input.cause as { code?: unknown })
        : null
    const causeCode =
      causeObj && typeof causeObj.code === 'string' && /^[A-Z0-9_]{2,32}$/.test(causeObj.code)
        ? ` (${causeObj.code})`
        : ''
    rawText = `${base}${causeCode}`
  } else {
    rawText = String(input ?? '')
  }

  let sanitized = rawText.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').trim()

  const variants = new Set<string>()
  for (const secret of secrets) {
    const trimmed = (secret ?? '').trim()
    if (trimmed.length < 4) continue
    variants.add(trimmed)
    try {
      const encoded = encodeURIComponent(trimmed)
      if (encoded.length >= 4) {
        variants.add(encoded)
      }
    } catch {
      // Ignore malformed URI components
    }
  }

  const orderedVariants = [...variants].sort((a, b) => b.length - a.length)
  for (const variant of orderedVariants) {
    if (sanitized.includes(variant)) {
      sanitized = sanitized.split(variant).join('[REDACTED]')
    }
  }

  sanitized = sanitized
    .replace(
      /([?&](?:key|api_key|apikey|token|access_token|auth|authorization|secret|password|sig)=)([^&#\s"'<>]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(x-goog-api-key|api[-_]?key|authorization)\s*[:=]\s*["']?([^\s"',;]+)["']?/gi, '$1: [REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\bsk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, '[REDACTED]')

  if (sanitized.length > 300) {
    return `${sanitized.slice(0, 297)}...`
  }
  return sanitized
}

/**
 * Formats an upstream HTTP failure without dumping raw response bodies that could echo credentials.
 */
export function formatSafeHttpError(
  provider: string,
  status: number,
  rawBody: string,
  secrets: readonly string[] = [],
): string {
  const trimmedBody = rawBody.trim()
  if (trimmedBody.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedBody) as {
        message?: unknown
        error?: { code?: unknown; status?: unknown; type?: unknown; message?: unknown }
      }
      const codeOrStatus = parsed?.error?.status ?? parsed?.error?.type ?? parsed?.error?.code
      const detail = parsed?.error?.message ?? parsed?.message
      const parts: string[] = [`${provider} HTTP ${status}`]
      if (typeof codeOrStatus === 'string' || typeof codeOrStatus === 'number') {
        parts.push(`(${String(codeOrStatus)})`)
      }
      if (typeof detail === 'string' && detail.trim()) {
        parts.push(`- ${detail.trim()}`)
      }
      return sanitizeSecretText(parts.join(' '), secrets)
    } catch {
      // Fall through to status-only message
    }
  }
  return sanitizeSecretText(`${provider} HTTP ${status}`, secrets)
}

export function normalizeTagVersion(tagOrRef: string): string {
  const trimmed = tagOrRef.trim()
  const withoutRefs = trimmed.replace(/^refs\/tags\//, '')
  return withoutRefs.replace(/^v/i, '')
}

/**
 * Extracts the markdown body for a specific version heading (`## [1.0.1] ...`)
 * from CHANGELOG.md, stopping cleanly at the next level-2 heading.
 */
export function extractChangelogSection(changelogMarkdown: string, versionOrTag: string): string {
  const normalized = normalizeTagVersion(versionOrTag)
  if (!normalized || !changelogMarkdown.trim()) {
    return ''
  }

  const lines = changelogMarkdown.split(/\r?\n/)
  const headerRegex = new RegExp(
    `^##\\s+\\[?v?${escapeRegExp(normalized)}\\]?(?:\\s+-\\s+.*|\\s*)$`,
    'i',
  )

  let startIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (headerRegex.test(line.trim())) {
      startIndex = i + 1
      break
    }
  }

  if (startIndex < 0) {
    return ''
  }

  const collected: string[] = []
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^##\s+/.test(line.trim())) {
      break
    }
    collected.push(line)
  }

  return collected.join('\n').trim()
}

export function groupCommitSubjects(commits: readonly CommitEntry[]): GroupedCommits {
  const grouped: GroupedCommits = {
    features: [],
    fixes: [],
    docsAndCi: [],
    other: [],
  }

  for (const commit of commits) {
    const subject = commit.subject.trim()
    if (!subject) continue

    if (/^(feat)(\([^)]+\))?:/i.test(subject)) {
      grouped.features.push(commit)
    } else if (/^(fix|perf|refactor)(\([^)]+\))?:/i.test(subject)) {
      grouped.fixes.push(commit)
    } else if (/^(docs|ci|build|chore|test)(\([^)]+\))?:/i.test(subject)) {
      grouped.docsAndCi.push(commit)
    } else {
      grouped.other.push(commit)
    }
  }

  return grouped
}

/**
 * Classifies commits into Lichii-aligned user-facing sections.
 */
export function groupCommitsForLichii(commits: readonly CommitEntry[]): LichiiGroupedCommits {
  const grouped: LichiiGroupedCommits = {
    newFeatures: [],
    bugFixes: [],
    telemetryAndMap: [],
    windowsLauncher: [],
    stabilityDocsCi: [],
  }

  for (const commit of commits) {
    const subject = commit.subject.trim()
    if (!subject) continue

    const parsed = subject.match(CONVENTIONAL_COMMIT_REGEX)
    const type = parsed?.[1]?.toLowerCase() ?? ''
    const scope = (parsed?.[2] ?? '').toLowerCase()
    const body = (parsed?.[4] ?? subject).toLowerCase()

    const isDocsOrCiScope = /\b(docs?|ci|release|changelog|license)\b/.test(scope)
    const isLauncherScope = /\b(launcher|win|windows|exe|build-win|smoke)\b/.test(scope)
    const isTelemetryScope = /\b(telemetry|lichii|skulltula|rpc|map|tracker|pin|floor)\b/.test(scope)

    const mentionsLauncher = /\b(launcher|hyruleatlas\.exe|ocarinamaps\.exe|build-win|smoke-test|nx2_switches|tray|winforms)\b/.test(body)
    const mentionsTelemetry = /\b(telemetry|lichii|skulltula|mod0|aslr|rpc|playerpin|placeview|floorgrid|worldmap|mastertable|save fallback)\b/.test(body)

    if (type === 'fix') {
      if (isDocsOrCiScope) {
        grouped.stabilityDocsCi.push(commit)
      } else {
        grouped.bugFixes.push(commit)
      }
      continue
    }

    if (isDocsOrCiScope || type === 'docs' || type === 'ci' || type === 'chore' || type === 'test' || type === 'build') {
      grouped.stabilityDocsCi.push(commit)
      continue
    }

    if (isLauncherScope || (!type && mentionsLauncher)) {
      grouped.windowsLauncher.push(commit)
      continue
    }

    if (isTelemetryScope || (!type && mentionsTelemetry)) {
      grouped.telemetryAndMap.push(commit)
      continue
    }

    if (type === 'feat' || /^(add|support|implement|introduce)\b/i.test(subject)) {
      grouped.newFeatures.push(commit)
      continue
    }

    grouped.stabilityDocsCi.push(commit)
  }

  return grouped
}

/**
 * Formats a commit entry into a Lichii-style bold-led plain-language bullet without raw prefixes.
 */
export function formatLichiiCommitBullet(commit: CommitEntry): string {
  const rawSubject = commit.subject.trim()
  const parsed = rawSubject.match(CONVENTIONAL_COMMIT_REGEX)
  const scope = parsed?.[2]?.trim() ?? ''
  let description = (parsed?.[4] ?? rawSubject).trim()

  let prSuffix = ''
  const prMatch = description.match(/\s*\((#\d+)\)\s*\.?$/)
  if (prMatch?.[1]) {
    prSuffix = ` (${prMatch[1]})`
    description = description.slice(0, prMatch.index).trim()
  } else if (commit.sha.trim()) {
    prSuffix = ` (\`${commit.sha.trim().slice(0, 7)}\`)`
  }

  description = description.replace(/\.+$/, '').trim()
  if (!description) {
    return `- **Repository update**${prSuffix}.`
  }

  if (scope) {
    const scopeLabel = formatScopeLabel(scope)
    if (!description.toLowerCase().startsWith(scopeLabel.toLowerCase())) {
      return `- **${scopeLabel}:** ${capitalizeFirst(description)}${prSuffix}.`
    }
  }

  const colonIdx = description.indexOf(': ')
  if (colonIdx > 1 && colonIdx < 48) {
    const lead = capitalizeFirst(description.slice(0, colonIdx).trim())
    const tail = description.slice(colonIdx + 2).trim()
    return `- **${lead}:** ${tail}${prSuffix}.`
  }

  return `- **${capitalizeFirst(description)}**${prSuffix}.`
}

/**
 * Parses GitHub auto-generated `What's Changed` PR bullets into commit-like entries as a fallback.
 */
export function parseGithubAutoNotesEntries(notes: string): CommitEntry[] {
  const entries: CommitEntry[] = []
  for (const line of notes.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = trimmed.match(/^\*\s+(.+?)\s+by\s+@\S+(?:\s+in\s+\S+\/pull\/(\d+))?\s*$/)
    if (!match?.[1]) continue
    const title = match[1].trim()
    const prNumber = match[2] ? ` (#${match[2]})` : ''
    entries.push({ sha: '', subject: `${title}${prNumber}` })
  }
  return entries
}

function formatTopLevelBullet(line: string): string {
  const content = line.slice(2).trim()
  if (!content) return line
  if (content.startsWith('**')) {
    return `- ${content}`
  }
  const colonIdx = content.indexOf(': ')
  if (colonIdx > 1 && colonIdx < 48) {
    const lead = capitalizeFirst(content.slice(0, colonIdx).trim())
    const tail = content.slice(colonIdx + 2).trim()
    return `- **${lead}:** ${tail}`
  }
  const clean = content.replace(/\.+$/, '')
  return `- **${capitalizeFirst(clean)}.**`
}

function mapChangelogHeadingToLichii(headingLine: string): string {
  const rawHeading = headingLine.replace(/^###\s+/, '').trim()
  const lower = rawHeading.toLowerCase()
  const headingMap: Record<string, string> = {
    added: 'New features',
    'new features': 'New features',
    fixed: 'Bug fixes',
    'bug fixes': 'Bug fixes',
    changed: 'Improvements & changes',
    security: 'Security & stability',
    removed: 'Removed',
    deprecated: 'Deprecated',
  }
  return `### ${headingMap[lower] ?? rawHeading}`
}

/**
 * Converts a CHANGELOG.md section into Lichii-aligned H3 headings and bold-led bullets,
 * extracting any leading blockquote callout separately.
 */
export function formatChangelogForLichii(changelogSection: string): {
  leadQuote: string | null
  body: string
} {
  const lines = changelogSection.trim().split(/\r?\n/)
  const leadLines: string[] = []
  const bodyLines: string[] = []

  let i = 0
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++
  while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
    leadLines.push((lines[i] ?? '').trim())
    i++
  }

  for (; i < lines.length; i++) {
    const rawLine = lines[i] ?? ''
    const trimmed = rawLine.trim()
    if (/^###\s+/.test(trimmed)) {
      bodyLines.push(mapChangelogHeadingToLichii(trimmed))
    } else if (/^-\s+/.test(rawLine)) {
      bodyLines.push(formatTopLevelBullet(rawLine))
    } else {
      bodyLines.push(rawLine)
    }
  }

  return {
    leadQuote: leadLines.length > 0 ? leadLines.join('\n') : null,
    body: bodyLines.join('\n').trim(),
  }
}

/**
 * Normalizes AI-generated release notes so outer headings, duplicate build lines,
 * or hallucinated download tables do not clash with deterministic release sections.
 */
export function normalizeAiSummary(aiSummary: string): string {
  let text = aiSummary.trim()
  if (!text) return ''

  const fenced = text.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```$/i)
  if (fenced?.[1]) {
    text = fenced[1].trim()
  }

  const lines = text.split(/\r?\n/)
  const filtered: string[] = []
  let skippingTrailingDownloads = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (
      filtered.length === 0 &&
      (/^#\s+/.test(trimmed) ||
        /^##\s+(?:Changes\s+since|What's\s+included|Release\s+Summary|AI\s+Release\s+Summary)/i.test(
          trimmed,
        ))
    ) {
      continue
    }

    if (filtered.length === 0 && /^Built\s+from\s+/i.test(trimmed)) {
      continue
    }

    if (/^##\s+(?:Downloads|Windows|What's\s+Changed|Changelog)\b/i.test(trimmed)) {
      skippingTrailingDownloads = true
      continue
    }

    if (skippingTrailingDownloads) {
      continue
    }

    filtered.push(line)
  }

  return filtered.join('\n').trim()
}

export function buildReleasePrompt(ctx: ReleasePromptContext): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = [
    ctx.instructions.trim() ||
      'Summarize the repository changes cleanly and accurately in English without inventing details.',
    'Format requirements: start with one `> **Headline.** ...` callout blockquote, then use H3 category headings (`### New features`, `### Bug fixes`, `### Telemetry & Map Tracking`, `### Windows Launcher`, `### Stability, docs & CI`) with bold-led plain-language bullets (`- **Topic:** detail`). Do not output `#`, `## Changes since`, `Built from`, or `## Downloads` / `## Windows` sections.',
  ].join('\n\n')

  const commitLines =
    ctx.commits.length > 0
      ? ctx.commits
          .slice(0, 60)
          .map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.subject}${c.author ? ` (${c.author})` : ''}`)
          .join('\n')
      : '- (No commit messages supplied)'

  const userParts: string[] = [
    `Target Release Version: ${ctx.version}`,
    `Previous Tag: ${ctx.previousTag ?? 'None (initial release)'}`,
    `Commits:\n${commitLines}`,
  ]

  if (ctx.changelogSection.trim()) {
    userParts.push(`Changelog Section:\n${ctx.changelogSection.trim()}`)
  }

  if (ctx.githubGeneratedNotes.trim()) {
    userParts.push(`Pull Requests / GitHub Auto-Notes:\n${ctx.githubGeneratedNotes.trim()}`)
  }

  return {
    systemPrompt,
    userPrompt: userParts.join('\n\n---\n\n'),
  }
}

function formatLichiiSectionBlock(title: string, entries: readonly CommitEntry[]): string | null {
  if (entries.length === 0) return null
  return [`### ${title}`, ...entries.slice(0, 20).map((entry) => formatLichiiCommitBullet(entry))].join('\n')
}

function buildSpanMetadataLine(input: ComposeReleaseBodyInput, commitCount: number): string {
  const parts: string[] = []
  const branchLabel = (input.headBranch ?? '').trim() || input.version
  const shortHead = (input.headSha ?? '').trim().slice(0, 7)

  if (shortHead) {
    parts.push(`Built from ${branchLabel} ${shortHead}.`)
  }
  if (input.previousTag) {
    const shortPrev = (input.previousTagSha ?? '').trim().slice(0, 7)
    if (shortPrev) {
      parts.push(`${input.previousTag} was ${shortPrev}.`)
    }
  }
  if (commitCount > 0) {
    parts.push(`That's ${commitCount} ${commitCount === 1 ? 'commit' : 'commits'}.`)
  }

  return parts.join(' ')
}

/**
 * Composes a Lichii-style GitHub Release body with `## Changes since <prevTag>`,
 * commit span lead, blockquote highlight, category sections, `## Downloads` metadata,
 * and a `## Windows` portable ZIP checksum table.
 */
export function composeReleaseBody(input: ComposeReleaseBodyInput): string {
  const safeRepoSlug = parseSafeRepoSlug(input.repoSlug) ?? ''
  const changeSections: string[] = []

  const changesHeading = input.previousTag
    ? `## Changes since ${input.previousTag}`
    : "## What's included"
  changeSections.push(changesHeading)

  const commitCount = input.changeCount ?? input.commits.length
  const spanLine = buildSpanMetadataLine(input, commitCount)
  if (spanLine) {
    changeSections.push(spanLine)
  }

  const cleanedAi = normalizeAiSummary(input.aiSummary ?? '')
  if (cleanedAi) {
    changeSections.push(cleanedAi)
  } else {
    const changelogRaw = input.changelogSection.trim()
    const defaultCallout =
      '> **Quick start.** Extract the portable Windows ZIP under **Downloads** and run **HyruleAtlas.exe** (includes 1-click Lichii RPC **6545** setup for *Ocarina of Time* Remake `0400486024DEC000`).'

    if (changelogRaw) {
      const formattedChangelog = formatChangelogForLichii(changelogRaw)
      const callout = input.leadSummary?.trim()
        ? `> ${input.leadSummary.trim()}`
        : (formattedChangelog.leadQuote ?? defaultCallout)
      changeSections.push(callout)
      if (formattedChangelog.body) {
        changeSections.push(formattedChangelog.body)
      }
    } else {
      const effectiveCommits =
        input.commits.length > 0 ? input.commits : parseGithubAutoNotesEntries(input.githubGeneratedNotes)
      const grouped = groupCommitsForLichii(effectiveCommits)
      const groupBlocks = [
        formatLichiiSectionBlock('New features', grouped.newFeatures),
        formatLichiiSectionBlock('Bug fixes', grouped.bugFixes),
        formatLichiiSectionBlock('Telemetry & Map Tracking', grouped.telemetryAndMap),
        formatLichiiSectionBlock('Windows Launcher', grouped.windowsLauncher),
        formatLichiiSectionBlock('Stability, docs & CI', grouped.stabilityDocsCi),
      ].filter((block): block is string => block !== null)

      const callout = input.leadSummary?.trim() ? `> ${input.leadSummary.trim()}` : defaultCallout
      changeSections.push(callout)

      if (groupBlocks.length > 0) {
        changeSections.push(groupBlocks.join('\n\n'))
      } else {
        changeSections.push(
          `### Release notes\n- **Hyrule Atlas \`${input.version}\`:** Portable Windows build and interactive Hyrule atlas release.`,
        )
      }
    }
  }

  if (safeRepoSlug) {
    const encodedVersion = encodeURIComponent(input.version)
    if (input.previousTag) {
      const encodedPrev = encodeURIComponent(input.previousTag)
      changeSections.push(
        `Full list: [${input.previousTag}...${input.version}](https://github.com/${safeRepoSlug}/compare/${encodedPrev}...${encodedVersion}).`,
      )
    } else {
      changeSections.push(
        `Full list: [commits/${input.version}](https://github.com/${safeRepoSlug}/commits/${encodedVersion}).`,
      )
    }
  }

  const buildRefLabel = (input.headBranch ?? '').trim() || input.version
  const fullSha = (input.headSha ?? '').trim()
  const downloadsMeta = fullSha
    ? `Automatic build of \`${buildRefLabel}\` at ${fullSha}.`
    : `Release build for \`${buildRefLabel}\`.`

  const downloadCell = safeRepoSlug
    ? `[zip](https://github.com/${safeRepoSlug}/releases/download/${encodeURIComponent(input.version)}/${encodeURIComponent(input.zipAssetName)})`
    : `\`${input.zipAssetName}\``
  const shaCell = input.zipSha256 ? `\`${input.zipSha256}\`` : 'Unavailable'

  const windowsTable = [
    '| Build Type | Standard | SHA-256 | Notes |',
    '| --- | --- | --- | --- |',
    `| amd64 / x86_64 | ${downloadCell} | ${shaCell} | Self-contained portable Windows x64 bundle (no Node.js install required) |`,
  ].join('\n')

  const downloadsBlock = [
    '## Downloads',
    downloadsMeta,
    '## Windows',
    'Windows packages are in-place zip files: extract and run `HyruleAtlas.exe`.',
    windowsTable,
    'Quick start: extract the ZIP anywhere on Windows 10/11 x64, launch `HyruleAtlas.exe`, click **1-Click Setup Lichii** if needed, and click **Start Map** to open Hyrule Atlas for *Ocarina of Time* Remake (`0400486024DEC000`).',
  ].join('\n\n')

  return `${changeSections.join('\n\n')}\n\n${downloadsBlock}\n`
}

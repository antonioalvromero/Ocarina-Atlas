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
  aiSummary: string | null
  aiProviderLabel: string | null
  changelogSection: string
  commits: readonly CommitEntry[]
  githubGeneratedNotes: string
  zipAssetName: string
  zipSha256: string | null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

export function buildReleasePrompt(ctx: ReleasePromptContext): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = [
    ctx.instructions.trim() ||
      'Summarize the repository changes cleanly and accurately in English without inventing details.',
    'Respond with clean Markdown ready to embed under a release summary heading (do not include an outer H1 title).',
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

function formatCommitGroupLines(title: string, entries: readonly CommitEntry[]): string[] {
  if (entries.length === 0) return []
  return [
    `### ${title}`,
    ...entries.slice(0, 20).map((entry) => `- ${entry.subject} (\`${entry.sha.slice(0, 7)}\`)`),
  ]
}

/**
 * Composes the complete GitHub Release Markdown body combining AI summary (or structured fallback),
 * portable Windows archive verification details, and GitHub's What's Changed / compare footer.
 */
export function composeReleaseBody(input: ComposeReleaseBodyInput): string {
  const sections: string[] = []
  const cleanedAi = (input.aiSummary ?? '').trim()

  if (cleanedAi) {
    const heading = input.aiProviderLabel
      ? `## AI Release Summary (${input.aiProviderLabel})`
      : '## AI Release Summary'
    sections.push(`${heading}\n\n${cleanedAi}`)
  } else {
    const fallbackParts: string[] = ['## Release Summary']
    const changelog = input.changelogSection.trim()
    if (changelog) {
      fallbackParts.push(changelog)
    } else {
      const grouped = groupCommitSubjects(input.commits)
      const groupBlocks = [
        ...formatCommitGroupLines('Features', grouped.features),
        ...formatCommitGroupLines('Fixes & Improvements', grouped.fixes),
        ...formatCommitGroupLines('Docs, CI & Tooling', grouped.docsAndCi),
        ...formatCommitGroupLines('Other Changes', grouped.other),
      ]
      if (groupBlocks.length > 0) {
        fallbackParts.push(groupBlocks.join('\n'))
      } else {
        fallbackParts.push(`Hyrule Atlas release \`${input.version}\`.`)
      }
    }
    sections.push(fallbackParts.join('\n\n'))
  }

  const downloadLines = [
    '## Windows Portable Bundle',
    `- **Download:** \`${input.zipAssetName}\` from the release assets below.`,
    '- **Quick Start:** Extract the folder anywhere on Windows 10/11 x64 and run `OcarinaMaps.exe` (no Node.js installation required).',
  ]
  if (input.zipSha256) {
    downloadLines.push(`- **SHA-256:** \`${input.zipSha256}\``)
  }
  sections.push(downloadLines.join('\n'))

  const autoNotes = input.githubGeneratedNotes.trim()
  if (autoNotes) {
    if (/^##\s+What's Changed/im.test(autoNotes)) {
      sections.push(autoNotes)
    } else {
      sections.push(`## What's Changed\n\n${autoNotes}`)
    }
  } else if (input.repoSlug) {
    const compareTarget = input.previousTag
      ? `compare/${input.previousTag}...${input.version}`
      : `commits/${input.version}`
    sections.push(
      `## Changelog\n\n**Full Changelog**: https://github.com/${input.repoSlug}/${compareTarget}`,
    )
  }

  return `${sections.join('\n\n')}\n`
}

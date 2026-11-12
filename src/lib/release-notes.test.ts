import { describe, expect, it } from 'vitest'
import {
  buildReleasePrompt,
  composeReleaseBody,
  extractChangelogSection,
  groupCommitSubjects,
  normalizeTagVersion,
} from './release-notes'

describe('normalizeTagVersion', () => {
  it('strips refs/tags prefix and leading v', () => {
    expect(normalizeTagVersion('refs/tags/v1.0.1')).toBe('1.0.1')
    expect(normalizeTagVersion('V2.3.0')).toBe('2.3.0')
    expect(normalizeTagVersion('1.0.0')).toBe('1.0.0')
  })
})

describe('extractChangelogSection', () => {
  const sample = [
    '# Changelog',
    '',
    '## [1.0.1] - 2026-11-11',
    '### Added',
    '- MIT License and AI release summaries',
    '',
    '## [1.0.0] - 2026-11-10',
    '### Added',
    '- Initial Hyrule Atlas release',
  ].join('\n')

  it('extracts only the requested version section', () => {
    const section = extractChangelogSection(sample, 'v1.0.1')
    expect(section).toContain('MIT License and AI release summaries')
    expect(section).not.toContain('Initial Hyrule Atlas release')
  })

  it('returns empty string when version does not exist', () => {
    expect(extractChangelogSection(sample, 'v9.9.9')).toBe('')
  })
})

describe('groupCommitSubjects', () => {
  it('groups conventional commit prefixes consistently', () => {
    const grouped = groupCommitSubjects([
      { sha: '1111111', subject: 'feat(launcher): add tray toggle' },
      { sha: '2222222', subject: 'fix(telemetry): clear stale ASLR cache' },
      { sha: '3333333', subject: 'ci: add Windows smoke test' },
      { sha: '4444444', subject: 'Update map dataset' },
    ])

    expect(grouped.features).toHaveLength(1)
    expect(grouped.fixes).toHaveLength(1)
    expect(grouped.docsAndCi).toHaveLength(1)
    expect(grouped.other).toHaveLength(1)
  })
})

describe('buildReleasePrompt', () => {
  it('includes release version, instructions, and supplied commits', () => {
    const prompt = buildReleasePrompt({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      instructions: 'Be concise.',
      commits: [{ sha: 'abcdef1234', subject: 'feat: add AI notes', author: 'antonio' }],
      changelogSection: '### Added\n- AI notes',
      githubGeneratedNotes: '',
    })

    expect(prompt.systemPrompt).toContain('Be concise.')
    expect(prompt.userPrompt).toContain('Target Release Version: v1.0.1')
    expect(prompt.userPrompt).toContain('Previous Tag: v1.0.0')
    expect(prompt.userPrompt).toContain('`abcdef1` feat: add AI notes (antonio)')
    expect(prompt.userPrompt).toContain('### Added')
  })
})

describe('composeReleaseBody', () => {
  it('renders AI summary, Windows SHA-256 details, and GitHub notes without duplicate What\'s Changed header', () => {
    const body = composeReleaseBody({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      repoSlug: 'antonioalvromero/Hyrule-Atlas',
      aiSummary: '- Added MIT License and automated AI release summaries.',
      aiProviderLabel: 'Gemini',
      changelogSection: '',
      commits: [],
      githubGeneratedNotes: "## What's Changed\n* PR #2 by @antonioalvromero",
      zipAssetName: 'OcarinaMaps-Lichii-Windows-x64.zip',
      zipSha256: 'deadbeef1234',
    })

    expect(body).toContain('## AI Release Summary (Gemini)')
    expect(body).toContain('- **SHA-256:** `deadbeef1234`')
    expect(body).toContain("## What's Changed\n* PR #2 by @antonioalvromero")
    expect(body.match(/## What's Changed/g)).toHaveLength(1)
  })

  it('falls back cleanly to CHANGELOG.md section and compare link when no AI summary is provided', () => {
    const body = composeReleaseBody({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      repoSlug: 'antonioalvromero/Hyrule-Atlas',
      aiSummary: null,
      aiProviderLabel: null,
      changelogSection: '### Added\n- MIT License',
      commits: [],
      githubGeneratedNotes: '',
      zipAssetName: 'OcarinaMaps-Lichii-Windows-x64.zip',
      zipSha256: null,
    })

    expect(body).toContain('## Release Summary')
    expect(body).toContain('- MIT License')
    expect(body).toContain('https://github.com/antonioalvromero/Hyrule-Atlas/compare/v1.0.0...v1.0.1')
  })
})

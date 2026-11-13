import { describe, expect, it } from 'vitest'
import {
  buildReleasePrompt,
  composeReleaseBody,
  extractChangelogSection,
  extractGitHubRepoSlugFromRemote,
  formatChangelogForLichii,
  formatLichiiCommitBullet,
  formatSafeHttpError,
  groupCommitsForLichii,
  groupCommitSubjects,
  isSafeGitRef,
  normalizeAiSummary,
  normalizeTagVersion,
  parseSafeRepoSlug,
  sanitizeSecretText,
  validateGitRef,
  validateModelName,
  validateRepoSlug,
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
    '- Initial Ocarina Atlas release',
  ].join('\n')

  it('extracts only the requested version section', () => {
    const section = extractChangelogSection(sample, 'v1.0.1')
    expect(section).toContain('MIT License and AI release summaries')
    expect(section).not.toContain('Initial Ocarina Atlas release')
  })

  it('returns empty string when version does not exist', () => {
    expect(extractChangelogSection(sample, 'v9.9.9')).toBe('')
  })
})

describe('commit grouping and Lichii bullet formatting', () => {
  it('groups conventional commit prefixes cleanly in groupCommitSubjects', () => {
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

  it('classifies commits into Lichii release sections and strips raw prefixes', () => {
    const grouped = groupCommitsForLichii([
      { sha: '1111111', subject: 'feat(ui): add dark mode toggle (#12)' },
      { sha: '2222222', subject: 'fix(telemetry): clear stale ASLR cache' },
      { sha: '3333333', subject: 'feat(telemetry): read Skulltula flags from masterTable' },
      { sha: '4444444', subject: 'feat(launcher): 1-click nx2_switches.txt setup' },
      { sha: '5555555', subject: 'ci: add Windows smoke test workflow' },
    ])

    expect(grouped.newFeatures).toHaveLength(1)
    expect(grouped.bugFixes).toHaveLength(1)
    expect(grouped.telemetryAndMap).toHaveLength(1)
    expect(grouped.windowsLauncher).toHaveLength(1)
    expect(grouped.stabilityDocsCi).toHaveLength(1)

    expect(formatLichiiCommitBullet(grouped.newFeatures[0]!)).toBe(
      '- **UI:** Add dark mode toggle (#12).',
    )
    expect(formatLichiiCommitBullet(grouped.bugFixes[0]!)).toBe(
      '- **Telemetry:** Clear stale ASLR cache (`2222222`).',
    )
    expect(formatLichiiCommitBullet(grouped.stabilityDocsCi[0]!)).toBe(
      '- **Add Windows smoke test workflow** (`5555555`).',
    )
  })
})

describe('formatChangelogForLichii & normalizeAiSummary', () => {
  it('maps Keep-a-Changelog headings to Lichii headings and preserves bold bullets', () => {
    const formatted = formatChangelogForLichii([
      '> **Release highlight.** Faster Skulltula reconciliation.',
      '',
      '### Added',
      '- **MIT License:** Permissive license for newly authored files.',
      '### Fixed',
      '- Avoid duplicate pins on reload',
    ].join('\n'))

    expect(formatted.leadQuote).toBe('> **Release highlight.** Faster Skulltula reconciliation.')
    expect(formatted.body).toContain('### New features')
    expect(formatted.body).toContain('### Bug fixes')
    expect(formatted.body).toContain('- **Avoid duplicate pins on reload.**')
  })

  it('strips outer headings, code fences, and duplicate Downloads blocks from AI summaries', () => {
    const normalized = normalizeAiSummary([
      '```markdown',
      '## Changes since v1.0.0',
      'Built from main 1234567. v1.0.0 was 0000000.',
      '',
      '> **Headline.** Big update.',
      '',
      '### New features',
      '- **Feature:** Details (#4).',
      '',
      '## Downloads',
      'Hallucinated table',
      '```',
    ].join('\n'))

    expect(normalized).toBe(
      ['> **Headline.** Big update.', '', '### New features', '- **Feature:** Details (#4).'].join(
        '\n',
      ),
    )
  })
})

describe('buildReleasePrompt', () => {
  it('includes release version, Lichii instructions, and supplied commits', () => {
    const prompt = buildReleasePrompt({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      instructions: 'Match Lichii style.',
      commits: [{ sha: 'abcdef1234', subject: 'feat: add AI notes', author: 'antonio' }],
      changelogSection: '### Added\n- AI notes',
      githubGeneratedNotes: '',
    })

    expect(prompt.systemPrompt).toContain('Match Lichii style.')
    expect(prompt.systemPrompt).toContain('### New features')
    expect(prompt.userPrompt).toContain('Target Release Version: v1.0.1')
    expect(prompt.userPrompt).toContain('Previous Tag: v1.0.0')
    expect(prompt.userPrompt).toContain('`abcdef1` feat: add AI notes (antonio)')
    expect(prompt.userPrompt).toContain('### Added')
  })
})

describe('composeReleaseBody', () => {
  it('renders Lichii-style AI release notes with span metadata, Downloads metadata, and Windows SHA-256 table', () => {
    const body = composeReleaseBody({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      repoSlug: 'antonioalvromero/Ocarina-Atlas',
      headBranch: 'main',
      headSha: '9bc568b000000000000000000000000000000000',
      previousTagSha: 'e009ec8000000000000000000000000000000000',
      aiSummary: [
        '> **Automated releases.** Ocarina Atlas now builds Lichii-style release notes automatically.',
        '',
        '### New features',
        '- **MIT License:** Added permissive MIT coverage for Ocarina Atlas telemetry and launcher code (#1).',
      ].join('\n'),
      aiProviderLabel: 'Gemini',
      changelogSection: '',
      commits: [{ sha: '478f743', subject: 'chore: add MIT license and release notes' }],
      githubGeneratedNotes: "## What's Changed\n* PR #1 by @antonioalvromero",
      zipAssetName: 'OcarinaAtlas-Windows-x64.zip',
      zipSha256: 'deadbeef1234',
    })

    expect(body).toContain('## Changes since v1.0.0')
    expect(body).toContain("Built from main 9bc568b. v1.0.0 was e009ec8. That's 1 commit.")
    expect(body).toContain('> **Automated releases.**')
    expect(body).toContain('### New features')
    expect(body).toContain(
      'Full list: [v1.0.0...v1.0.1](https://github.com/antonioalvromero/Ocarina-Atlas/compare/v1.0.0...v1.0.1).',
    )
    expect(body).toContain('## Downloads')
    expect(body).toContain('Automatic build of `main` at 9bc568b000000000000000000000000000000000.')
    expect(body).toContain('## Windows')
    expect(body).toContain(
      '| amd64 / x86_64 | [zip](https://github.com/antonioalvromero/Ocarina-Atlas/releases/download/v1.0.1/OcarinaAtlas-Windows-x64.zip) | `deadbeef1234` |',
    )
    expect(body).not.toContain("## What's Changed")
  })

  it('falls back cleanly to CHANGELOG.md in Lichii format when no AI summary is provided', () => {
    const body = composeReleaseBody({
      version: 'v1.0.1',
      previousTag: 'v1.0.0',
      repoSlug: 'antonioalvromero/Ocarina-Atlas',
      headBranch: 'main',
      headSha: '9bc568b111111111111111111111111111111111',
      previousTagSha: 'e009ec8222222222222222222222222222222222',
      aiSummary: null,
      aiProviderLabel: null,
      changelogSection: '### Added\n- **MIT License:** Permissive license for newly authored code.',
      commits: [{ sha: '478f743', subject: 'chore: add MIT license' }],
      githubGeneratedNotes: '',
      zipAssetName: 'OcarinaAtlas-Windows-x64.zip',
      zipSha256: null,
    })

    expect(body).toContain('## Changes since v1.0.0')
    expect(body).toContain('### New features')
    expect(body).toContain('- **MIT License:** Permissive license for newly authored code.')
    expect(body).toContain('| amd64 / x86_64 | [zip](https://github.com/antonioalvromero/Ocarina-Atlas/releases/download/v1.0.1/OcarinaAtlas-Windows-x64.zip) | Unavailable |')
  })

  it('formats commits into Lichii sections without raw feat:/fix: prefixes when changelog is empty', () => {
    const body = composeReleaseBody({
      version: 'v1.0.0',
      previousTag: null,
      repoSlug: 'antonioalvromero/Ocarina-Atlas',
      aiSummary: null,
      aiProviderLabel: null,
      changelogSection: '',
      commits: [
        { sha: 'aaaa111', subject: 'feat(telemetry): live Lichii RPC tracking' },
        { sha: 'bbbb222', subject: 'fix: prevent stale floor badge' },
      ],
      githubGeneratedNotes: '',
      zipAssetName: 'OcarinaAtlas-Windows-x64.zip',
      zipSha256: 'cafebabe',
    })

    expect(body).toContain("## What's included")
    expect(body).toContain('### Telemetry & Map Tracking')
    expect(body).toContain('- **Telemetry:** Live Lichii RPC tracking (`aaaa111`).')
    expect(body).toContain('### Bug fixes')
    expect(body).toContain('- **Prevent stale floor badge** (`bbbb222`).')
    expect(body).not.toMatch(/\b(feat|fix)\(/i)
  })
})

describe('security sanitization and input validation', () => {
  it('redacts raw, URL-encoded, query-param, header, and token-prefix secrets', () => {
    const secret = 'AIzaTest+Secret/Key=12345'
    const encoded = encodeURIComponent(secret)
    const msg = `Request to https://example.com?key=${encoded}\nAuthorization: Bearer sk-proj-abc123456789\nx-goog-api-key=${secret}\nghp_1234567890abcdef`

    const sanitized = sanitizeSecretText(msg, [secret])
    expect(sanitized).not.toContain(secret)
    expect(sanitized).not.toContain(encoded)
    expect(sanitized).not.toContain('sk-proj-')
    expect(sanitized).not.toContain('ghp_')
    expect(sanitized).not.toContain('\n')
    expect(sanitized).toContain('[REDACTED]')
  })

  it('extracts safe cause codes from Error objects without dumping raw bodies', () => {
    const err = new TypeError('fetch failed', {
      cause: { code: 'ECONNREFUSED', url: 'https://api.example.com?key=supersecretvalue' },
    })
    const sanitized = sanitizeSecretText(err, ['supersecretvalue'])
    expect(sanitized).toBe('TypeError: fetch failed (ECONNREFUSED)')
    expect(sanitized).not.toContain('supersecretvalue')

    const htmlErr = formatSafeHttpError('Gemini API', 403, '<html>bad key AIzaFakeSecret99999</html>', [
      'AIzaFakeSecret99999',
    ])
    expect(htmlErr).toBe('Gemini API HTTP 403')

    const jsonErr = formatSafeHttpError(
      'Gemini API',
      400,
      JSON.stringify({
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'API key AIzaFakeSecret99999 is invalid',
        },
      }),
      ['AIzaFakeSecret99999'],
    )
    expect(jsonErr).toBe('Gemini API HTTP 400 (INVALID_ARGUMENT) - API key [REDACTED] is invalid')
    expect(jsonErr).not.toContain('AIzaFakeSecret99999')
  })

  it('validates repo slugs, git refs, remote URLs, and AI model names strictly', () => {
    expect(parseSafeRepoSlug('antonioalvromero/Ocarina-Atlas')).toBe('antonioalvromero/Ocarina-Atlas')
    expect(parseSafeRepoSlug('../evil/repo')).toBeNull()
    expect(() => validateRepoSlug('invalid slug')).toThrow()

    expect(
      extractGitHubRepoSlugFromRemote('https://github.com/antonioalvromero/Ocarina-Atlas.git'),
    ).toBe('antonioalvromero/Ocarina-Atlas')
    expect(
      extractGitHubRepoSlugFromRemote('git@github.com:antonioalvromero/Ocarina-Atlas.git'),
    ).toBe('antonioalvromero/Ocarina-Atlas')

    expect(isSafeGitRef('v1.0.1')).toBe(true)
    expect(isSafeGitRef('-bad-flag')).toBe(false)
    expect(isSafeGitRef('v1.0.0\nmalicious=1')).toBe(false)
    expect(() => validateGitRef('v1..v2')).toThrow()

    expect(validateModelName('gemini-2.5-flash')).toBe('gemini-2.5-flash')
    expect(() => validateModelName('gemini/../../evil')).toThrow()
  })
})

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildReleasePrompt,
  composeReleaseBody,
  extractChangelogSection,
  extractGitHubRepoSlugFromRemote,
  formatSafeHttpError,
  isSafeGitRef,
  normalizeTagVersion,
  parseSafeRepoSlug,
  sanitizeSecretText,
  validateGitRef,
  validateModelName,
  validateRepoSlug,
} from '../src/lib/release-notes.ts'

function getActiveSecrets(extraSecrets = []) {
  const candidates = [
    process.env.GITHUB_TOKEN,
    process.env.COPILOT_GITHUB_TOKEN,
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    ...extraSecrets,
  ]
  return candidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
}

function readOptionalFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return ''
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function runGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function computeFileSha256(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function resolvePreviousTag(headRef) {
  const explicit = (process.env.PREVIOUS_TAG ?? '').trim()
  if (explicit) {
    return validateGitRef(explicit, 'PREVIOUS_TAG')
  }
  const safeHead = validateGitRef(headRef, 'headRef')
  const tag = runGit(['describe', '--tags', '--abbrev=0', '--match', 'v*', `${safeHead}^`])
  return tag && isSafeGitRef(tag) ? tag : null
}

function resolveCommitSha(ref) {
  if (!ref || !isSafeGitRef(ref)) return null
  const sha = runGit(['rev-parse', '--verify', `${ref}^{commit}`])
  return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null
}

function resolveBuildBranch(fallbackTag) {
  const explicit = (process.env.BUILD_REF ?? process.env.HEAD_BRANCH ?? '').trim()
  if (explicit && isSafeGitRef(explicit)) {
    return explicit
  }
  const currentBranch = runGit(['symbolic-ref', '--short', 'HEAD'])
  if (currentBranch && isSafeGitRef(currentBranch)) {
    return currentBranch
  }
  return fallbackTag
}

function collectCommits(previousTag, headRef) {
  const safeHead = validateGitRef(headRef, 'headRef')
  const safePrev = previousTag ? validateGitRef(previousTag, 'previousTag') : null
  const rangeArgs = safePrev ? [`${safePrev}..${safeHead}`] : ['-n', '40', safeHead]
  const raw = runGit(['log', ...rangeArgs, '--no-merges', '--format=%H%x1f%s%x1f%an%x1e', '--'])
  if (!raw) return []

  const entries = []
  for (const record of raw.split('\x1e')) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const [sha = '', subject = '', author = ''] = trimmed.split('\x1f')
    if (sha && subject) {
      entries.push({ sha: sha.trim(), subject: subject.trim(), author: author.trim() || undefined })
    }
  }
  return entries
}

async function fetchGithubGeneratedNotes({ repoSlug, token, tagName, previousTag }) {
  const safeSlug = parseSafeRepoSlug(repoSlug)
  if (!safeSlug || !token || !tagName) return ''
  try {
    const payload = { tag_name: tagName }
    if (previousTag) {
      payload.previous_tag_name = previousTag
    }
    const resp = await fetch(`https://api.github.com/repos/${safeSlug}/releases/generate-notes`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
      console.warn(`GitHub generate-notes returned HTTP ${resp.status}; falling back cleanly.`)
      return ''
    }
    const data = await resp.json()
    return typeof data.body === 'string' ? data.body.trim() : ''
  } catch (err) {
    console.warn(
      'Unable to fetch GitHub auto-generated notes:',
      sanitizeSecretText(err, getActiveSecrets([token])),
    )
    return ''
  }
}

async function generateWithGemini({ apiKey, model, systemPrompt, userPrompt }) {
  const safeModel = validateModelName(model)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeModel)}:generateContent`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!resp.ok) {
    const rawBody = await resp.text().catch(() => '')
    throw new Error(formatSafeHttpError('Gemini API', resp.status, rawBody, getActiveSecrets([apiKey])))
  }
  const data = await resp.json()
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim()
}

async function generateWithOpenAI({ apiKey, model, systemPrompt, userPrompt }) {
  const safeModel = validateModelName(model)
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: safeModel,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!resp.ok) {
    const rawBody = await resp.text().catch(() => '')
    throw new Error(formatSafeHttpError('OpenAI API', resp.status, rawBody, getActiveSecrets([apiKey])))
  }
  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

async function main() {
  const rawTag =
    process.env.RELEASE_TAG ||
    process.env.GITHUB_REF_NAME ||
    runGit(['describe', '--tags', '--exact-match']) ||
    'v1.0.1'
  const tagName = validateGitRef(rawTag, 'RELEASE_TAG')

  const rawHeadRef = process.env.HEAD_REF || tagName || 'HEAD'
  const candidateHeadRef = validateGitRef(rawHeadRef, 'HEAD_REF')
  const resolvedHeadRef = resolveCommitSha(candidateHeadRef) ? candidateHeadRef : 'HEAD'

  const previousTag = resolvePreviousTag(resolvedHeadRef)
  const headSha = resolveCommitSha(resolvedHeadRef)
  const previousTagSha = resolveCommitSha(previousTag)
  const headBranch = resolveBuildBranch(tagName)

  const envRepo = (process.env.GITHUB_REPOSITORY ?? '').trim()
  const repoSlug = envRepo
    ? validateRepoSlug(envRepo)
    : extractGitHubRepoSlugFromRemote(runGit(['remote', 'get-url', 'origin'])) ?? ''
  const githubToken = (process.env.GITHUB_TOKEN ?? '').trim()
  const zipPath = process.env.ZIP_PATH || 'release/OcarinaAtlas-Windows-x64.zip'
  const outPath = process.env.OUT_PATH || 'release/RELEASE_NOTES.md'

  const commits = collectCommits(previousTag, resolvedHeadRef)
  const changelogSection = extractChangelogSection(
    readOptionalFile('CHANGELOG.md'),
    normalizeTagVersion(tagName),
  )
  const instructions = readOptionalFile('.github/release-notes-instructions.md')
  const githubGeneratedNotes = await fetchGithubGeneratedNotes({
    repoSlug,
    token: githubToken,
    tagName,
    previousTag,
  })

  let aiSummary = readOptionalFile(process.env.COPILOT_NOTES_FILE).trim()
  let aiProviderLabel = aiSummary ? 'GitHub Copilot' : null

  const { systemPrompt, userPrompt } = buildReleasePrompt({
    version: tagName,
    previousTag,
    instructions,
    commits,
    changelogSection,
    githubGeneratedNotes,
  })

  if (!aiSummary && (process.env.GEMINI_API_KEY ?? '').trim()) {
    try {
      const model = validateModelName(process.env.GEMINI_MODEL || 'gemini-2.5-flash')
      aiSummary = await generateWithGemini({
        apiKey: process.env.GEMINI_API_KEY.trim(),
        model,
        systemPrompt,
        userPrompt,
      })
      if (aiSummary) {
        aiProviderLabel = `Gemini · ${model}`
      }
    } catch (err) {
      console.warn(
        'Gemini release summary failed; falling back:',
        sanitizeSecretText(err, getActiveSecrets()),
      )
    }
  }

  if (!aiSummary && (process.env.OPENAI_API_KEY ?? '').trim()) {
    try {
      const model = validateModelName(process.env.OPENAI_MODEL || 'gpt-4o-mini')
      aiSummary = await generateWithOpenAI({
        apiKey: process.env.OPENAI_API_KEY.trim(),
        model,
        systemPrompt,
        userPrompt,
      })
      if (aiSummary) {
        aiProviderLabel = `OpenAI · ${model}`
      }
    } catch (err) {
      console.warn(
        'OpenAI release summary failed; falling back:',
        sanitizeSecretText(err, getActiveSecrets()),
      )
    }
  }

  const zipSha256 = computeFileSha256(zipPath)
  const body = composeReleaseBody({
    version: tagName,
    previousTag,
    repoSlug,
    headBranch,
    headSha,
    previousTagSha,
    aiSummary: aiSummary || null,
    aiProviderLabel,
    changelogSection,
    commits,
    githubGeneratedNotes,
    zipAssetName: path.basename(zipPath),
    zipSha256,
  })

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, body, 'utf8')
  console.log(`Generated release notes (${aiProviderLabel ?? 'structured changelog fallback'}) -> ${outPath}`)
}

main().catch((err) => {
  console.error('Release notes generation failed:', sanitizeSecretText(err, getActiveSecrets()))
  process.exit(1)
})

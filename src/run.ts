import * as core from '@actions/core'
import * as github from '@actions/github'
import { loadConfig } from './config'
import { formatCoverage } from './core/coverage'
import { buildReviewBody, parseReviews } from './core/review'
import { shouldSkipByCommitPrefixes, shouldSkipByPaths, shouldSkipReview } from './core/skip'
import { buildDiffFromFiles, listPrCommitSubjects, listPrFiles, postReview } from './github'
import { loadBaseConfig, readPrSnapshot } from './github/configSource'
import { callLlm, readLlmSettings } from './llm'

interface PrPayload {
  number: number
  draft?: boolean
  user?: { login: string; type?: string }
  head?: { sha?: string }
  base?: { sha?: string }
}

export interface RunOutcome {
  status: 'completed' | 'partial' | 'skipped' | 'stale' | 'failed'
  head_sha: string
  findings_count: number
  reviewed_files: number
  omitted_files: number
  reason: string
}

export async function run(context = github.context): Promise<RunOutcome> {
  const outcome: RunOutcome = {
    status: 'failed',
    head_sha: '',
    findings_count: 0,
    reviewed_files: 0,
    omitted_files: 0,
    reason: 'Unable to initialize the PR review',
  }
  try {
    await execute(context, outcome)
  } catch {
    outcome.status = 'failed'
    outcome.reason ||= 'Review execution failed'
    core.setFailed(`评审失败：${outcome.reason}`)
  }
  for (const [name, value] of Object.entries(outcome)) core.setOutput(name, value)
  core.info(`Inori: ${outcome.status} — ${outcome.reason}`)
  try {
    await core.summary
      .addHeading('Inori')
      .addTable([
        [
          { data: 'Status', header: true },
          { data: 'Head SHA', header: true },
          { data: 'Findings', header: true },
          { data: 'Reviewed files', header: true },
          { data: 'Omitted files', header: true },
        ],
        [
          outcome.status,
          outcome.head_sha.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
          String(outcome.findings_count),
          String(outcome.reviewed_files),
          String(outcome.omitted_files),
        ],
      ])
      .write()
  } catch (error) {
    core.warning(
      `Cannot write job summary: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return outcome
}

async function execute(context: typeof github.context, outcome: RunOutcome): Promise<void> {
  const pr = context.payload.pull_request as PrPayload | undefined
  if (!pr) throw new Error('A pull_request payload is required')
  const headSha = pr.head?.sha
  const baseSha = pr.base?.sha
  outcome.head_sha = headSha ?? ''
  if (!headSha || !baseSha) throw new Error('PR head and base SHA are required')
  const octokit = github.getOctokit(core.getInput('github_token', { required: true }))
  const repo = context.repo
  const isCurrent = async (): Promise<number | null> => {
    const current = await readPrSnapshot(octokit, repo, pr.number)
    if (current.headSha === headSha && current.baseSha === baseSha) return current.changedFiles
    outcome.status = 'stale'
    outcome.reason = 'PR head or base changed; no review was published'
    return null
  }
  outcome.reason = 'Unable to verify the PR snapshot'
  if ((await isCurrent()) === null) return
  outcome.reason = 'Unable to load or validate trusted base configuration'
  const config = loadConfig(await loadBaseConfig(octokit, repo, baseSha))
  const skipCheck = shouldSkipReview({
    isDraft: pr.draft,
    skipDraft: config.skipDraft,
    author: pr.user,
    ignoreBots: config.ignoreBots,
    ignoreAuthors: config.ignoreAuthors,
    lang: config.language,
  })
  if (skipCheck.skip) {
    outcome.status = 'skipped'
    outcome.reason = skipCheck.reason ?? 'PR excluded by review rules'
    return
  }
  outcome.reason = 'Unable to read PR commits'
  const prefixesSkip = shouldSkipByCommitPrefixes(
    config.ignoreCommitPrefixes.length > 0
      ? await listPrCommitSubjects(octokit, repo, pr.number)
      : [],
    config.ignoreCommitPrefixes,
  )
  if (prefixesSkip.skip) {
    outcome.status = 'skipped'
    outcome.reason = prefixesSkip.reason ?? 'Commit prefixes excluded by review rules'
    return
  }
  outcome.reason = 'Unable to read a consistent PR diff'
  if ((await isCurrent()) === null) return
  const files = await listPrFiles(octokit, repo, pr.number)
  const totalFiles = await isCurrent()
  if (totalFiles === null) return
  const missingFiles = Math.max(0, totalFiles - files.length)
  const pathsSkip = shouldSkipByPaths(
    files.map((f) => f.filename),
    config.pathsIgnore,
  )
  if (pathsSkip.skip && missingFiles === 0) {
    outcome.status = 'skipped'
    outcome.reason = pathsSkip.reason ?? 'Paths excluded by review rules'
    return
  }
  const { diff, fileLines, coverage } = buildDiffFromFiles(files, config)
  outcome.omitted_files =
    coverage.omittedFiles.length + coverage.unavailableFiles.length + missingFiles
  if (!diff.trim()) {
    outcome.status = outcome.omitted_files > 0 ? 'partial' : 'skipped'
    outcome.reason =
      outcome.omitted_files > 0
        ? 'No reviewable diff within budget or available patches; no review was published'
        : 'No reviewable changes after ignore rules'
    return
  }
  outcome.reason = 'Unable to configure or complete the LLM review'
  const settings = readLlmSettings(config)
  const content = await callLlm(diff, config, settings)
  outcome.reason = 'The model response is not a valid complete review'
  const parsed = parseReviews(content, fileLines, config.language)
  outcome.reviewed_files = coverage.reviewedFiles.length
  outcome.findings_count = parsed.inlines.length + parsed.bodyItems.length
  const coverageText = formatCoverage(coverage, headSha, config.language, missingFiles)
  outcome.reason = 'Unable to build the complete review body within the configured size limit'
  const body = buildReviewBody(
    {
      summary: `${parsed.summary}\n\n${coverageText}`,
      bodyItems: parsed.bodyItems,
      model: settings.model,
    },
    config.language,
    config.maxBodyChars,
  )
  outcome.reason = 'Unable to verify the PR snapshot before publishing'
  if ((await isCurrent()) === null) return
  outcome.reason = 'Unable to publish the complete review; previous comments were retained'
  const published = await postReview(
    octokit,
    repo,
    pr.number,
    headSha,
    body,
    parsed.inlines,
    outcome.omitted_files > 0 ? 'keep' : config.onUpdate,
  )
  outcome.status =
    outcome.omitted_files > 0 || published.failedInlineCount > 0 ? 'partial' : 'completed'
  outcome.reason =
    outcome.status === 'partial'
      ? 'Review published with coverage omissions or inline fallback; inspect the summary'
      : 'Review published successfully'
}

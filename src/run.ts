import * as core from '@actions/core'
import * as github from '@actions/github'
import { loadConfig } from './config'
import { mergeBatchReviews } from './core/batches'
import { formatCoverage } from './core/coverage'
import { buildReviewBody, parseReviews } from './core/review'
import { shouldSkipByCommitPrefixes, shouldSkipByPaths, shouldSkipReview } from './core/skip'
import { listPrCommitSubjects, listPrFiles, postReview } from './github'
import { loadBaseConfig, readPrSnapshot } from './github/configSource'
import { buildReviewBatchesFromFiles } from './github/diffSource'
import { BudgetExceededError, callLlm, createLlmRequestBudget, readLlmSettings } from './llm'

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
  requests_used: number
  batches_completed: number
  batches_failed: number
  batches_unstarted: number
  duration_ms: number
  prompt_tokens: number | ''
  completion_tokens: number | ''
  total_tokens: number | ''
  usage_complete: boolean
}

export async function run(context = github.context): Promise<RunOutcome> {
  const outcome: RunOutcome = {
    status: 'failed',
    head_sha: '',
    findings_count: 0,
    reviewed_files: 0,
    omitted_files: 0,
    reason: 'Unable to initialize the PR review',
    requests_used: 0,
    batches_completed: 0,
    batches_failed: 0,
    batches_unstarted: 0,
    duration_ms: 0,
    prompt_tokens: '',
    completion_tokens: '',
    total_tokens: '',
    usage_complete: false,
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
      .addTable([
        [
          { data: 'LLM requests', header: true },
          { data: 'Completed batches', header: true },
          { data: 'Failed batches', header: true },
          { data: 'Unstarted batches', header: true },
          { data: 'Model phase (ms)', header: true },
        ],
        [
          String(outcome.requests_used),
          String(outcome.batches_completed),
          String(outcome.batches_failed),
          String(outcome.batches_unstarted),
          String(outcome.duration_ms),
        ],
      ])
      .addTable([
        [
          { data: 'Reported prompt tokens', header: true },
          { data: 'Reported completion tokens', header: true },
          { data: 'Reported total tokens', header: true },
          { data: 'Usage complete', header: true },
        ],
        [
          String(outcome.prompt_tokens === '' ? 'unknown' : outcome.prompt_tokens),
          String(outcome.completion_tokens === '' ? 'unknown' : outcome.completion_tokens),
          String(outcome.total_tokens === '' ? 'unknown' : outcome.total_tokens),
          String(outcome.usage_complete),
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
  const { batches, coverage } = buildReviewBatchesFromFiles(files, config)
  outcome.omitted_files =
    coverage.omittedFiles.length + coverage.unavailableFiles.length + missingFiles
  if (batches.length === 0) {
    outcome.status = outcome.omitted_files > 0 ? 'partial' : 'skipped'
    outcome.reason =
      outcome.omitted_files > 0
        ? 'No reviewable diff within budget or available patches; no review was published'
        : 'No reviewable changes after ignore rules'
    return
  }
  outcome.reason = 'Unable to configure or complete the LLM review'
  const settings = readLlmSettings(config)
  const budget = createLlmRequestBudget(config.maxRequests)
  const results: (ReturnType<typeof parseReviews> & { index: number; includedFiles: string[] })[] =
    []
  coverage.failedFiles = []
  coverage.unstartedFiles = []
  let nextBatch = 0
  const started = performance.now()
  try {
    await Promise.all(
      Array.from({ length: Math.min(config.reviewConcurrency, batches.length) }, async () => {
        for (;;) {
          const batch = batches[nextBatch++]
          if (!batch) return
          if (budget.used >= budget.limit) {
            coverage.unstartedFiles?.push(...batch.includedFiles)
            outcome.batches_unstarted += 1
            continue
          }
          let stage = 'LLM request'
          try {
            const content = await callLlm(batch.diff, config, settings, budget)
            stage = 'model response validation'
            const parsed = parseReviews(content, batch.fileLines, config.language)
            results.push({ ...parsed, index: batch.index, includedFiles: batch.includedFiles })
            outcome.batches_completed += 1
          } catch (error) {
            const reason =
              error instanceof BudgetExceededError ? 'LLM request budget exhausted' : stage
            core.warning(`Review batch ${batch.index + 1} failed (${reason})`)
            coverage.failedFiles?.push(...batch.includedFiles)
            outcome.batches_failed += 1
          }
        }
      }),
    )
  } finally {
    outcome.duration_ms = Math.max(0, Math.round(performance.now() - started))
    outcome.requests_used = budget.used
    outcome.prompt_tokens = budget.usage?.promptTokens ?? ''
    outcome.completion_tokens = budget.usage?.completionTokens ?? ''
    outcome.total_tokens = budget.usage?.totalTokens ?? ''
    outcome.usage_complete = budget.used > 0 && budget.usageRequests === budget.used
  }
  const successes = results.sort((a, b) => a.index - b.index)
  coverage.reviewedFiles = successes.flatMap((result) => result.includedFiles)
  outcome.omitted_files += coverage.failedFiles.length + coverage.unstartedFiles.length
  outcome.reviewed_files = coverage.reviewedFiles.length
  if (successes.length === 0) {
    outcome.reason = 'No review batch completed successfully; no review was published'
    throw new Error(outcome.reason)
  }
  const parsed = mergeBatchReviews(successes, config.language)
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

import * as core from '@actions/core'
import * as github from '@actions/github'
import { loadConfig } from './config'
import { buildReviewBody, parseReviews } from './core/review'
import { shouldSkipByCommitPrefixes, shouldSkipByPaths, shouldSkipReview } from './core/skip'
import {
  buildDiffFromFiles,
  listPrCommitSubjects,
  listPrFiles,
  type OctokitInstance,
  postReview,
  type RepoContext,
} from './github'
import { callLlm, readLlmSettings } from './llm'

// ── 入口：编排管道 ──
// 配置（含提供商自动推断与 Coding Plan）→ 早退 → 拉 diff → LLM 评审 → 发布。

interface PrPayload {
  number: number
  draft?: boolean
  user?: { login: string; type?: string }
  head: { sha: string }
}

async function main(): Promise<void> {
  const ctx = github.context
  if (!ctx.payload.pull_request) {
    core.setFailed('非 pull_request 事件，跳过')
    return
  }
  const pr = ctx.payload.pull_request as PrPayload

  const config = loadConfig()

  // 智能早退检查（草稿 PR、Bot PR、忽略作者），先于任何 API/LLM 调用
  const skipCheck = shouldSkipReview({
    isDraft: pr.draft,
    skipDraft: config.skipDraft,
    author: pr.user,
    ignoreBots: config.ignoreBots,
    ignoreAuthors: config.ignoreAuthors,
    lang: config.language,
  })
  if (skipCheck.skip) {
    core.info(skipCheck.reason ?? '跳过评审')
    return
  }

  const settings = readLlmSettings(config)
  const token = core.getInput('github_token', { required: true })
  const octokit: OctokitInstance = github.getOctokit(token)
  const repo: RepoContext = { owner: ctx.repo.owner, repo: ctx.repo.repo }

  // 提交标识级整体跳过：PR 全部 commit 的 subject 命中前缀（纯 ci:/docs:
  // 类提交，Conventional Commits 语义即「无代码变更」）时跳过，最省路径
  const prefixesSkip = shouldSkipByCommitPrefixes(
    await listPrCommitSubjects(octokit, repo, pr.number),
    config.ignoreCommitPrefixes,
  )
  if (prefixesSkip.skip) {
    core.info(prefixesSkip.reason ?? '跳过评审')
    return
  }

  const files = await listPrFiles(octokit, repo, pr.number)

  // 路径级整体跳过：纯 CI/文档类变更（全部命中 paths_ignore）无代码语义，
  // 先于 diff 组装退出，不耗 LLM 额度
  const pathsSkip = shouldSkipByPaths(
    files.map((f) => f.filename),
    config.pathsIgnore,
  )
  if (pathsSkip.skip) {
    core.info(pathsSkip.reason ?? '跳过评审')
    return
  }

  const { diff, fileLines } = buildDiffFromFiles(files, config)
  if (!diff || diff.trim().length === 0) {
    core.info('无有效代码变更需评审')
    return
  }
  const providerLabel = config.providerName ? ` [${config.providerName}]` : ''
  const endpointLabel = config.isCustomEndpoint ? '（自定义）' : '（自动填充）'
  core.info(
    `评审 ${repo.owner}/${repo.repo} PR #${pr.number}，diff ${diff.length} 字符，模型 ${settings.model}${providerLabel}，端点 ${settings.endpoint}${endpointLabel}`,
  )

  const content = await callLlm(diff, config, settings)
  const { summary, inlines, bodyItems } = parseReviews(content, fileLines, config.language)
  // 空结果也发布「未发现问题」并替换/更新旧评审，避免上一轮的意见残留误导
  const body = buildReviewBody(
    { summary, bodyItems, model: settings.model },
    config.language,
    config.maxBodyChars,
  )

  await postReview(octokit, repo, pr.number, pr.head.sha, body, inlines, config.onUpdate)
  core.info('评审已发布')
}

main().catch((e) => {
  core.setFailed(`评审失败：${e instanceof Error ? e.message : String(e)}`)
})

import * as core from '@actions/core'
import type { ResolvedConfig } from '../config'
import { buildDiffBatches, type ReviewBatch } from '../core/batches'
import type { ReviewCoverage } from '../core/coverage'
import { addedLines, formatDiffAndTruncate, isIgnored, type PrFile } from '../core/diff'
import { type OctokitInstance, paginate, type RepoContext } from './paginate'

// ── PR diff 拉取（过滤 + 安全截断 + 行号映射）──

export interface PrDiff {
  diff: string
  coverage: ReviewCoverage
  /** 各保留文件的新增行号集合（inline 锚点校验依据） */
  fileLines: Map<string, Set<number>>
}

export interface BatchPlan {
  batches: ReviewBatch[]
  coverage: ReviewCoverage
}

function partitionFiles(files: PrFile[], config: ResolvedConfig) {
  const validFiles: { filename: string; patch: string }[] = []
  const ignoredFiles: string[] = []
  const unavailableFiles: string[] = []
  for (const file of files) {
    if (isIgnored(file.filename, config.ignorePatterns)) {
      ignoredFiles.push(file.filename)
      core.info(`忽略 ${file.filename}`)
    } else if (!file.patch?.trim()) {
      unavailableFiles.push(file.filename)
    } else {
      validFiles.push({ filename: file.filename, patch: file.patch })
    }
  }
  return { validFiles, ignoredFiles, unavailableFiles }
}

export function buildReviewBatchesFromFiles(files: PrFile[], config: ResolvedConfig): BatchPlan {
  const { validFiles, ignoredFiles, unavailableFiles } = partitionFiles(files, config)
  const { batches, omittedFiles } = buildDiffBatches(
    validFiles,
    config.maxDiffChars,
    config.batchDiffChars,
  )
  return {
    batches,
    coverage: { reviewedFiles: [], ignoredFiles, omittedFiles, unavailableFiles },
  }
}

/** 分页拉取 PR 全部文件列表（含 patch 字段） */
export async function listPrFiles(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<PrFile[]> {
  return paginate<PrFile>((page) =>
    octokit.rest.pulls
      .listFiles({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data as PrFile[]),
  )
}

/**
 * 文件列表经 ignore 过滤与按文件块安全截断，
 * 返回 diff 文本与被保留文件的新增行号集合。
 */
export function buildDiffFromFiles(files: PrFile[], config: ResolvedConfig): PrDiff {
  const { validFiles, ignoredFiles, unavailableFiles } = partitionFiles(files, config)

  const result = formatDiffAndTruncate(validFiles, config.maxDiffChars, config.language)
  if (result.truncated) {
    core.info(
      `diff 过大，已按文件块安全截断到 ${config.maxDiffChars} 字符以内（略去 ${result.omittedCount} 个文件）`,
    )
  }

  // 仅对保留在 diff 中的文件建立行号映射
  const includedSet = new Set(result.includedFiles)
  const fileLines = new Map<string, Set<number>>()
  for (const f of validFiles) {
    if (includedSet.has(f.filename)) fileLines.set(f.filename, addedLines(f.patch))
  }
  return {
    diff: result.diff,
    fileLines,
    coverage: {
      reviewedFiles: result.includedFiles,
      ignoredFiles,
      omittedFiles: result.omittedFiles,
      unavailableFiles,
    },
  }
}

/** 分页拉取 PR 全部 commit（取 subject 首行用于前缀跳过判定） */
export async function listPrCommitSubjects(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<string[]> {
  const commits = await paginate<{ commit: { message: string } }>((page) =>
    octokit.rest.pulls
      .listCommits({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data as { commit: { message: string } }[]),
  )
  return commits.map((c) => c.commit.message.split('\n')[0] ?? '')
}

import * as core from "@actions/core";
import { addedLines, formatDiffAndTruncate, isIgnored, type PrFile } from "../core/diff";
import type { ResolvedConfig } from "../config";
import { paginate, type OctokitInstance, type RepoContext } from "./paginate";

// ── PR diff 拉取（过滤 + 安全截断 + 行号映射）──

export interface PrDiff {
  diff: string;
  /** 各保留文件的新增行号集合（inline 锚点校验依据） */
  fileLines: Map<string, Set<number>>;
}

/**
 * 分页拉取 PR 全部文件，经过 ignore 过滤与按文件块安全截断，
 * 返回 diff 文本与被保留文件的新增行号集合。
 */
export async function getPrDiff(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  config: ResolvedConfig
): Promise<PrDiff> {
  const files = await paginate<PrFile>((page) =>
    octokit.rest.pulls
      .listFiles({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data as PrFile[])
  );

  const validFiles: { filename: string; patch: string }[] = [];
  for (const f of files) {
    if (isIgnored(f.filename, config.ignorePatterns)) {
      core.info(`忽略 ${f.filename}`);
      continue;
    }
    if (!f.patch) continue;
    validFiles.push({ filename: f.filename, patch: f.patch });
  }

  const result = formatDiffAndTruncate(validFiles, config.maxDiffChars, config.language);
  if (result.truncated) {
    core.info(
      `diff 过大，已按文件块安全截断到 ${config.maxDiffChars} 字符以内（略去后续 ${result.omittedCount} 个文件）`
    );
  }

  // 仅对保留在 diff 中的文件建立行号映射
  const includedSet = new Set(result.includedFiles);
  const fileLines = new Map<string, Set<number>>();
  for (const f of validFiles) {
    if (includedSet.has(f.filename)) fileLines.set(f.filename, addedLines(f.patch));
  }
  return { diff: result.diff, fileLines };
}

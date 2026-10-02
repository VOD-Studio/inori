import type { Lang } from './i18n'

export interface ReviewCoverage {
  reviewedFiles: string[]
  ignoredFiles: string[]
  omittedFiles: string[]
  unavailableFiles: string[]
  failedFiles?: string[]
  unstartedFiles?: string[]
}

function escapeText(value: string): string {
  return value
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()!|~]/g, '\\$&')
}

export function formatCoverage(
  coverage: ReviewCoverage,
  headSha: string,
  lang: Lang,
  missingFiles = 0,
): string {
  const zh = lang === 'zh'
  const missing = Math.max(0, Math.floor(missingFiles))
  const failedFiles = coverage.failedFiles ?? []
  const unstartedFiles = coverage.unstartedFiles ?? []
  const partial =
    coverage.omittedFiles.length +
      coverage.unavailableFiles.length +
      missing +
      failedFiles.length +
      unstartedFiles.length >
    0
  const lines = [
    zh ? '## 评审覆盖范围' : '## Review coverage',
    `${zh ? '提交' : 'Commit'}: ${escapeText(headSha)}`,
    zh
      ? `已评审 ${coverage.reviewedFiles.length} 个文件；按配置忽略 ${coverage.ignoredFiles.length} 个；预算不足略过 ${coverage.omittedFiles.length} 个；无可用 patch ${coverage.unavailableFiles.length} 个；API 未返回 ${missing} 个。`
      : `Reviewed ${coverage.reviewedFiles.length} files; ignored by configuration ${coverage.ignoredFiles.length}; omitted by budget ${coverage.omittedFiles.length}; unavailable patches ${coverage.unavailableFiles.length}; missing from API ${missing}.`,
  ]
  if (failedFiles.length || unstartedFiles.length) {
    lines.push(
      zh
        ? `批次评审失败 ${failedFiles.length} 个文件；请求预算耗尽未启动 ${unstartedFiles.length} 个文件。`
        : `Failed batch reviews: ${failedFiles.length} files; not started because the request budget was exhausted: ${unstartedFiles.length} files.`,
    )
  }
  if (partial) {
    lines.push(
      zh
        ? '本次仅覆盖部分变更；结论不适用于未评审文件。'
        : 'This review covers only part of the changes; conclusions do not apply to unreviewed files.',
    )
  }
  for (const [label, files] of [
    [zh ? '预算不足略过' : 'Omitted by budget', coverage.omittedFiles],
    [zh ? '无可用 patch' : 'Unavailable patches', coverage.unavailableFiles],
    [zh ? '批次评审失败' : 'Failed batch reviews', failedFiles],
    [zh ? '请求预算耗尽未启动' : 'Not started: request budget exhausted', unstartedFiles],
  ] as const) {
    if (!files.length) continue
    lines.push(`\n${label}:`)
    for (const file of files.slice(0, 20)) {
      lines.push(`- ${escapeText(file.slice(0, 200))}${file.length > 200 ? '…' : ''}`)
    }
    if (files.length > 20) {
      lines.push(zh ? `- 另有 ${files.length - 20} 个文件。` : `- ${files.length - 20} more files.`)
    }
  }
  return lines.join('\n\n')
}

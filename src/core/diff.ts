import { minimatch } from 'minimatch'
import type { Lang } from './i18n'

// ── 默认忽略模式（常见锁文件、压缩产物、矢量图、发布清单）──
// 与 DEFAULTS 一起构成内置默认值，用户通过 ignore_patterns 追加而非覆盖。

export const DEFAULT_IGNORE_PATTERNS = [
  // 锁文件
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'go.sum',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  // 压缩产物与映射
  '*.min.js',
  '*.min.css',
  '*.map',
  // 矢量图与二进制资源
  '*.svg',
  // 发版清单
  'CHANGELOG.md',
  '.release-please-manifest.json',
]

/** GitHub PR 文件条目（listFiles 响应的裁剪视图） */
export interface PrFile {
  filename: string
  patch?: string
}

/** 判断文件是否匹配忽略模式（支持裸文件名与目录内 glob） */
export function isIgnored(path: string, patterns: string[]): boolean {
  return patterns.some((p) => path === p || minimatch(path, p) || minimatch(path, `**/${p}`))
}

/**
 * 解析 patch，返回新增行（+ 行）在目标文件里的行号集合。
 * 用于校验 inline 锚点合法性——评论只能落在真实存在的行上。
 */
export function addedLines(patch: string): Set<number> {
  const lines = new Set<number>()
  let current = 0
  let oldRemaining = 0
  let newRemaining = 0
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      oldRemaining = hunk[1] === undefined ? 1 : Number(hunk[1])
      current = Number(hunk[2])
      newRemaining = hunk[3] === undefined ? 1 : Number(hunk[3])
      continue
    }
    // 只在 hunk 内解析内容：+++ 和 --- 也可能是实际新增、删除的代码。
    if (oldRemaining === 0 && newRemaining === 0) continue
    if (line.startsWith('+') && newRemaining > 0) {
      lines.add(current++)
      newRemaining--
    } else if (line.startsWith('-') && oldRemaining > 0) {
      oldRemaining--
    } else if (line.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
      current++
      oldRemaining--
      newRemaining--
    }
  }
  return lines
}

// ── Diff 组装与按文件块安全截断 ──

export interface FormattedDiffResult {
  diff: string
  truncated: boolean
  omittedCount: number
  includedFiles: string[]
  omittedFiles: string[]
}

/** 超限文件整块跳过，继续尝试后续文件，避免首个大文件耗尽所有评审预算。 */
export function formatDiffAndTruncate(
  files: PrFile[],
  maxDiffChars: number,
  _lang: Lang = 'zh',
): FormattedDiffResult {
  const chunks: string[] = []
  const includedFiles: string[] = []
  const omittedFiles: string[] = []
  let currentLength = 0
  const limit = Number.isFinite(maxDiffChars) ? Math.max(0, Math.floor(maxDiffChars)) : 0

  for (const file of files) {
    if (!file.patch?.trim()) continue
    const chunk = `--- ${file.filename}\n${file.patch}`
    const nextLength = currentLength + (chunks.length > 0 ? 1 : 0) + chunk.length
    if (nextLength > limit) {
      omittedFiles.push(file.filename)
      continue
    }
    chunks.push(chunk)
    includedFiles.push(file.filename)
    currentLength = nextLength
  }

  return {
    diff: chunks.join('\n'),
    truncated: omittedFiles.length > 0,
    omittedCount: omittedFiles.length,
    includedFiles,
    omittedFiles,
  }
}

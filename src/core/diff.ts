import { minimatch } from 'minimatch'
import { type Lang, t } from './i18n'

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
  let cur: number | null = null
  for (const line of patch.split('\n')) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      cur = parseInt(m[1], 10)
      continue
    }
    // 文件头形如 "+++ b/path"（带空格），需跳过
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+') && cur !== null) {
      lines.add(cur)
      cur += 1
    } else if (line.startsWith('-')) {
    } else if (!line.startsWith('\\') && cur !== null) {
      cur += 1
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
}

/**
 * 组装 PR diff 并按文件块安全截断。
 * 每个文件以 `--- filename` 头开始，超过 maxDiffChars 时回退到上一个
 * 完整文件块边界截断（保证送入 LLM 的 patch 语法完整），并追加提示信息。
 */
export function formatDiffAndTruncate(
  files: { filename: string; patch?: string }[],
  maxDiffChars: number,
  lang: Lang = 'zh',
): FormattedDiffResult {
  const table = t(lang)
  const validFiles = files.filter((f) => f.patch && f.patch.trim().length > 0)
  if (validFiles.length === 0) {
    return { diff: '', truncated: false, omittedCount: 0, includedFiles: [] }
  }

  const chunks: string[] = []
  const includedFiles: string[] = []
  let currentLen = 0
  let truncated = false
  let omittedCount = 0

  for (let i = 0; i < validFiles.length; i++) {
    const f = validFiles[i]
    const chunk = `--- ${f.filename}\n${f.patch}`
    const nextLen = chunks.length === 0 ? chunk.length : currentLen + 1 + chunk.length

    if (chunks.length > 0 && nextLen > maxDiffChars) {
      truncated = true
      omittedCount = validFiles.length - i
      break
    }

    chunks.push(chunk)
    includedFiles.push(f.filename)
    currentLen = nextLen

    if (currentLen >= maxDiffChars && i < validFiles.length - 1) {
      truncated = true
      omittedCount = validFiles.length - (i + 1)
      break
    }
  }

  let diff = chunks.join('\n')
  if (truncated && omittedCount > 0) {
    diff += `\n\n${table.diffTruncated(omittedCount)}`
  }

  return { diff, truncated, omittedCount, includedFiles }
}

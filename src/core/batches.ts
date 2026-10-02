import { addedLines, type PrFile } from './diff'
import type { Lang } from './i18n'
import type { InlineComment } from './review'

export interface ReviewBatch {
  index: number
  diff: string
  includedFiles: string[]
  fileLines: Map<string, Set<number>>
}

export interface BatchReviewResult {
  index: number
  includedFiles: string[]
  summary: string
  inlines: InlineComment[]
  bodyItems: string[]
}

export function buildDiffBatches(
  files: PrFile[],
  maxDiffChars: number,
  batchDiffChars: number,
): { batches: ReviewBatch[]; omittedFiles: string[] } {
  const totalLimit = Number.isFinite(maxDiffChars) ? Math.max(0, Math.floor(maxDiffChars)) : 0
  const batchLimit = Number.isFinite(batchDiffChars)
    ? Math.min(totalLimit, Math.max(0, Math.floor(batchDiffChars)))
    : 0
  const batches: ReviewBatch[] = []
  const omittedFiles: string[] = []
  let totalLength = 0
  for (const file of files) {
    if (!file.patch?.trim()) continue
    const chunk = `--- ${file.filename}\n${file.patch}`
    let batch = batches.at(-1)
    const fitsCurrent = batch !== undefined && batch.diff.length + 1 + chunk.length <= batchLimit
    // Count the separator across batch boundaries too, preserving single-request selection.
    const addedLength = chunk.length + (batches.length > 0 ? 1 : 0)
    if (chunk.length > batchLimit || totalLength + addedLength > totalLimit) {
      omittedFiles.push(file.filename)
      continue
    }
    if (!fitsCurrent || batch === undefined) {
      batch = { index: batches.length, diff: '', includedFiles: [], fileLines: new Map() }
      batches.push(batch)
    }
    batch.diff += `${batch.includedFiles.length ? '\n' : ''}${chunk}`
    batch.includedFiles.push(file.filename)
    batch.fileLines.set(file.filename, addedLines(file.patch))
    totalLength += addedLength
  }
  return { batches, omittedFiles }
}

function displayFile(path: string): string {
  return path
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()!|~]/g, '\\$&')
}

export function mergeBatchReviews(
  results: BatchReviewResult[],
  lang: Lang = 'zh',
): { summary: string; inlines: InlineComment[]; bodyItems: string[] } {
  const inlines: InlineComment[] = []
  const bodyItems: string[] = []
  const seenInlines = new Set<string>()
  const seenBodyItems = new Set<string>()
  const summaries: string[] = []
  for (const result of [...results].sort((a, b) => a.index - b.index)) {
    summaries.push(
      `### ${lang === 'zh' ? '批次' : 'Batch'} ${result.index + 1}\n\n${result.includedFiles.map(displayFile).join(', ')}\n\n${result.summary}`,
    )
    for (const inline of result.inlines) {
      const key = JSON.stringify([inline.path, inline.line, inline.body])
      if (seenInlines.has(key)) continue
      seenInlines.add(key)
      inlines.push(inline)
    }
    for (const body of result.bodyItems) {
      if (seenBodyItems.has(body)) continue
      seenBodyItems.add(body)
      bodyItems.push(body)
    }
  }
  if (results.length > 1) {
    summaries.unshift(
      lang === 'zh'
        ? '以下结论仅适用于各批次列出的文件。'
        : 'Each summary applies only to the files in its batch.',
    )
  }
  return { summary: summaries.join('\n\n'), inlines, bodyItems }
}

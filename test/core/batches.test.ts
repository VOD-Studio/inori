import { describe, expect, it } from 'vitest'
import { buildDiffBatches, mergeBatchReviews } from '../../src/core/batches'
import { formatDiffAndTruncate } from '../../src/core/diff'
import { parseReviews } from '../../src/core/review'

const file = (filename: string, line = 1) => ({
  filename,
  patch: `@@ -0,0 +${line} @@\n+added`,
})
const chunkLength = (value: ReturnType<typeof file>) =>
  `--- ${value.filename}\n${value.patch}`.length

describe('buildDiffBatches', () => {
  it('packs complete files into ordered batches within both budgets', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((path) => file(path))
    const batchLimit = chunkLength(files[0]) * 2 + 1
    const result = buildDiffBatches(files, 1000, batchLimit)
    expect(result.batches.map((batch) => batch.includedFiles)).toEqual([
      ['a.ts', 'b.ts'],
      ['c.ts', 'd.ts'],
      ['e.ts'],
    ])
    expect(result.batches.every((batch) => batch.diff.length <= batchLimit)).toBe(true)
    expect(result.batches.map((batch) => batch.index)).toEqual([0, 1, 2])
    expect(result.omittedFiles).toEqual([])
  })

  it('omits an oversized file and continues considering later small files', () => {
    const result = buildDiffBatches(
      [{ filename: 'large.ts', patch: '+'.repeat(500) }, file('small.ts')],
      1000,
      100,
    )
    expect(result.omittedFiles).toEqual(['large.ts'])
    expect(result.batches[0].includedFiles).toEqual(['small.ts'])
  })

  it('counts actual headers and separators in the total budget across batches', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => file(path))
    const single = chunkLength(files[0])
    const budget = single * 3 + 2
    const result = buildDiffBatches(files, budget, single * 2 + 1)
    expect(result.batches.map((batch) => batch.includedFiles)).toEqual([['a.ts', 'b.ts'], ['c.ts']])
    expect(result.batches.map((batch) => batch.diff).join('\n').length).toBe(budget)
    expect(result.omittedFiles).toEqual(['d.ts'])
  })

  it('keeps the previous single-request selection when total and batch budgets match', () => {
    const files = [file('a.ts'), { filename: 'large.ts', patch: '+'.repeat(500) }, file('b.ts')]
    const old = formatDiffAndTruncate(files, 100)
    const result = buildDiffBatches(files, 100, 100)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].diff).toBe(old.diff)
    expect(result.omittedFiles).toEqual(old.omittedFiles)
  })

  it('does not create a second batch by evading one separator at the exact total boundary', () => {
    const files = [file('a.ts'), file('b.ts')]
    const total = chunkLength(files[0]) + chunkLength(files[1])
    const result = buildDiffBatches(files, total, total)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].includedFiles).toEqual(['a.ts'])
    expect(result.omittedFiles).toEqual(['b.ts'])
  })

  it('only accepts inline anchors belonging to the reviewed batch', () => {
    const first = file('a.ts', 4)
    const second = file('b.ts', 9)
    const result = buildDiffBatches([first, second], 1000, chunkLength(first))
    expect(result.batches).toHaveLength(2)
    expect(result.batches[0].fileLines.get('a.ts')).toEqual(new Set([4]))
    expect(result.batches[0].fileLines.has('b.ts')).toBe(false)
    const parsed = parseReviews(
      JSON.stringify({ summary: 'Issue', reviews: [{ path: 'b.ts', line: 9, comment: 'Detail' }] }),
      result.batches[0].fileLines,
    )
    expect(parsed.inlines).toEqual([])
    expect(parsed.bodyItems).toHaveLength(1)
  })

  it('caps an oversized batch budget at the total budget', () => {
    const result = buildDiffBatches([file('a.ts'), file('b.ts')], 35, 1000)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].diff.length).toBeLessThanOrEqual(35)
    expect(result.omittedFiles).toEqual(['b.ts'])
  })
})

describe('mergeBatchReviews', () => {
  it('restores batch order, scopes summaries and deduplicates only identical findings', () => {
    const duplicate = { path: 'a.ts', line: 1, body: 'same' }
    const different = { ...duplicate, body: 'different' }
    const result = mergeBatchReviews(
      [
        {
          index: 2,
          includedFiles: ['c.ts'],
          summary: 'third',
          inlines: [duplicate, different],
          bodyItems: ['same body'],
        },
        {
          index: 0,
          includedFiles: ['a.ts'],
          summary: 'first',
          inlines: [duplicate],
          bodyItems: ['same body', 'other'],
        },
      ],
      'en',
    )
    expect(result.inlines).toEqual([duplicate, different])
    expect(result.bodyItems).toEqual(['same body', 'other'])
    expect(result.summary).toContain('Each summary applies only')
    expect(result.summary.indexOf('Batch 1')).toBeLessThan(result.summary.indexOf('Batch 3'))
    expect(result.summary).toContain('a.ts\n\nfirst')
  })

  it('does not invent a clean result for no successful batches', () => {
    expect(mergeBatchReviews([])).toEqual({ summary: '', inlines: [], bodyItems: [] })
  })

  it('escapes untrusted filenames in batch scope labels', () => {
    const result = mergeBatchReviews([
      {
        index: 0,
        includedFiles: ['[x](url)\n<script>'],
        summary: 'ok',
        inlines: [],
        bodyItems: [],
      },
    ])
    expect(result.summary).toContain('\\[x\\]\\(url\\) &lt;script&gt;')
  })
})

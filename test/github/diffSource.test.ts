import * as core from '@actions/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../../src/config'
import { buildDiffFromFiles, buildReviewBatchesFromFiles } from '../../src/github/diffSource'

const config = { ignorePatterns: ['*.lock'], maxDiffChars: 100, language: 'zh' } as ResolvedConfig

afterEach(() => vi.restoreAllMocks())

describe('buildDiffFromFiles', () => {
  it('classifies every file and only maps lines actually sent for review', () => {
    vi.spyOn(core, 'info').mockImplementation(() => {})
    const result = buildDiffFromFiles(
      [
        { filename: 'big.ts', patch: '+'.repeat(200) },
        { filename: 'ignored.lock' },
        { filename: 'missing.bin' },
        { filename: 'blank.ts', patch: '  \n' },
        { filename: 'small.ts', patch: '@@ -0,0 +1 @@\n+hello' },
      ],
      config,
    )
    expect(result.coverage).toEqual({
      reviewedFiles: ['small.ts'],
      ignoredFiles: ['ignored.lock'],
      omittedFiles: ['big.ts'],
      unavailableFiles: ['missing.bin', 'blank.ts'],
    })
    expect([...result.fileLines.keys()]).toEqual(['small.ts'])
    expect(result.fileLines.get('small.ts')).toEqual(new Set([1]))
    expect(result.diff.length).toBeLessThanOrEqual(100)
  })

  it('retains omission evidence when no file fits the budget', () => {
    vi.spyOn(core, 'info').mockImplementation(() => {})
    const result = buildDiffFromFiles([{ filename: 'a.ts', patch: '+a' }], {
      ...config,
      maxDiffChars: 1,
    })
    expect(result.diff).toBe('')
    expect(result.fileLines.size).toBe(0)
    expect(result.coverage.omittedFiles).toEqual(['a.ts'])
  })
})

describe('buildReviewBatchesFromFiles', () => {
  it('plans batches without counting planned files as completed reviews', () => {
    const result = buildReviewBatchesFromFiles(
      [
        { filename: 'a.ts', patch: '@@ -0,0 +1 @@\n+a' },
        { filename: 'ignored.lock' },
        { filename: 'binary.bin' },
        { filename: 'big.ts', patch: '+'.repeat(100) },
        { filename: 'b.ts', patch: '@@ -0,0 +8 @@\n+b' },
      ],
      { ...config, maxDiffChars: 200, batchDiffChars: 35 },
    )
    expect(result.coverage).toEqual({
      reviewedFiles: [],
      ignoredFiles: ['ignored.lock'],
      omittedFiles: ['big.ts'],
      unavailableFiles: ['binary.bin'],
    })
    expect(result.batches.map((batch) => batch.includedFiles)).toEqual([['a.ts'], ['b.ts']])
    expect(result.batches[1].fileLines.get('b.ts')).toEqual(new Set([8]))
  })
})

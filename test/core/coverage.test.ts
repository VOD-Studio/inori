import { describe, expect, it } from 'vitest'
import { formatCoverage, type ReviewCoverage } from '../../src/core/coverage'

const complete: ReviewCoverage = {
  reviewedFiles: ['a.ts'],
  ignoredFiles: ['pnpm-lock.yaml'],
  omittedFiles: [],
  unavailableFiles: [],
}

describe('formatCoverage', () => {
  it('shows head and counts without labeling ignored files as incomplete', () => {
    const body = formatCoverage(complete, 'abc123', 'zh')
    expect(body).toContain('提交: abc123')
    expect(body).toContain('已评审 1 个文件')
    expect(body).toContain('按配置忽略 1 个')
    expect(body).not.toContain('仅覆盖部分变更')
  })

  it('discloses omitted and unavailable files in Chinese', () => {
    const body = formatCoverage(
      { ...complete, omittedFiles: ['big.ts'], unavailableFiles: ['binary.bin'] },
      'abc',
      'zh',
    )
    expect(body).toContain('仅覆盖部分变更')
    expect(body).toContain('big.ts')
    expect(body).toContain('binary.bin')
  })

  it('missing API entries mark otherwise complete coverage as partial', () => {
    const body = formatCoverage(complete, 'abc', 'en', 9)
    expect(body).toContain('Commit: abc')
    expect(body).toContain('missing from API 9')
    expect(body).toContain('covers only part')
  })

  it('escapes Markdown, HTML and embedded newlines in filenames', () => {
    const body = formatCoverage(
      { ...complete, omittedFiles: ['[click](https://bad)\n<script>`x`'] },
      'abc',
      'en',
    )
    expect(body).toContain('\\[click\\]\\(https://bad\\) &lt;script&gt;\\`x\\`')
    expect(body).not.toContain('<script>')
  })

  it('bounds both number and length of listed filenames', () => {
    const omittedFiles = Array.from({ length: 100 }, (_, index) => `${index}-${'x'.repeat(500)}`)
    const body = formatCoverage({ ...complete, omittedFiles }, 'abc', 'en')
    expect(body).toContain('80 more files')
    expect(body).not.toContain('20-')
    expect(body.length).toBeLessThan(5000)
  })
})

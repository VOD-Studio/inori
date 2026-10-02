import { describe, expect, it } from 'vitest'
import {
  addedLines,
  DEFAULT_IGNORE_PATTERNS,
  formatDiffAndTruncate,
  isIgnored,
} from '../../src/core/diff'

describe('DEFAULT_IGNORE_PATTERNS 与 isIgnored', () => {
  it('匹配所有主流锁文件', () => {
    const locks = [
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'go.sum',
      'Cargo.lock',
      'poetry.lock',
      'composer.lock',
      'sub/dir/Cargo.lock',
    ]
    for (const lock of locks) {
      expect(isIgnored(lock, DEFAULT_IGNORE_PATTERNS)).toBe(true)
    }
  })

  it('匹配压缩产物与 sourcemap', () => {
    expect(isIgnored('dist/bundle.min.js', DEFAULT_IGNORE_PATTERNS)).toBe(true)
    expect(isIgnored('styles/theme.min.css', DEFAULT_IGNORE_PATTERNS)).toBe(true)
    expect(isIgnored('dist/app.js.map', DEFAULT_IGNORE_PATTERNS)).toBe(true)
  })

  it('匹配 SVG 矢量图资源', () => {
    expect(isIgnored('public/icons/logo.svg', DEFAULT_IGNORE_PATTERNS)).toBe(true)
    expect(isIgnored('icon.svg', DEFAULT_IGNORE_PATTERNS)).toBe(true)
  })

  it('匹配发版清单与 Changelog', () => {
    expect(isIgnored('CHANGELOG.md', DEFAULT_IGNORE_PATTERNS)).toBe(true)
    expect(isIgnored('.release-please-manifest.json', DEFAULT_IGNORE_PATTERNS)).toBe(true)
    expect(isIgnored('pkg/.release-please-manifest.json', DEFAULT_IGNORE_PATTERNS)).toBe(true)
  })

  it('普通源码不被忽略', () => {
    expect(isIgnored('src/index.ts', DEFAULT_IGNORE_PATTERNS)).toBe(false)
    expect(isIgnored('web/app.tsx', DEFAULT_IGNORE_PATTERNS)).toBe(false)
    expect(isIgnored('cmd/main.go', DEFAULT_IGNORE_PATTERNS)).toBe(false)
  })
})

describe('isIgnored 自定义模式', () => {
  it('自定义 glob 模式生效', () => {
    expect(isIgnored('README.md', ['*.md'])).toBe(true)
    expect(isIgnored('docs/guide.md', ['*.md'])).toBe(true)
    expect(isIgnored('src/index.ts', ['*.md'])).toBe(false)
  })

  it('空 patterns 不忽略任何文件', () => {
    expect(isIgnored('pnpm-lock.yaml', [])).toBe(false)
  })
})

describe('addedLines', () => {
  it('提取连续新增行号', () => {
    const patch = '@@ -1,3 +1,5 @@\n unchanged\n-old line\n+new line 1\n+new line 2\n ctx'
    expect(addedLines(patch)).toEqual(new Set([2, 3]))
  })

  it('hunk 内 +++ 是真实新增内容，后续行号不偏移', () => {
    const patch = '@@ -1,0 +10,2 @@\n+++ counter\n+real add'
    expect(addedLines(patch)).toEqual(new Set([10, 11]))
  })

  it('完整 unified diff 的文件头不计入新增行', () => {
    const patch =
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n ctx\n+++ counter\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -0,0 +1 @@\n+new file'
    expect(addedLines(patch)).toEqual(new Set([1, 2]))
  })

  it('hunk 内 --- 删除内容不消费新行号，无换行标记不消费计数', () => {
    const patch = '@@ -2,2 +3,2 @@\n--- counter\n\\ No newline at end of file\n+new\n ctx'
    expect(addedLines(patch)).toEqual(new Set([3]))
  })

  it('多 hunk 合并行号', () => {
    const patch = '@@ -1,1 +5,2 @@\n+first\n ctx\n@@ -10,1 +20,2 @@\n+second\n ctx'
    expect(addedLines(patch)).toEqual(new Set([5, 20]))
  })

  it('删除行不占用行号，上下文推进行号', () => {
    // hunk +6 → ctx 推进到 7 → -行不推进 → +added 落在 line 7
    const patch = '@@ -1,3 +6,3 @@\n ctx\n-removed\n+added\n ctx2'
    expect(addedLines(patch)).toEqual(new Set([7]))
  })

  it('空 patch 返回空集合', () => {
    expect(addedLines('')).toEqual(new Set())
  })
})

describe('formatDiffAndTruncate (Issue 4)', () => {
  it('空文件或无有效 patch 返回空', () => {
    const res = formatDiffAndTruncate([], 1000)
    expect(res.diff).toBe('')
    expect(res.truncated).toBe(false)
    expect(res.omittedCount).toBe(0)

    const res2 = formatDiffAndTruncate([{ filename: 'a.ts', patch: '' }], 1000)
    expect(res2.diff).toBe('')
    expect(res2.truncated).toBe(false)
  })

  it('文件未超限时完整返回', () => {
    const files = [
      { filename: 'a.ts', patch: '+line 1' },
      { filename: 'b.ts', patch: '+line 2' },
    ]
    const res = formatDiffAndTruncate(files, 1000, 'zh')
    expect(res.truncated).toBe(false)
    expect(res.omittedCount).toBe(0)
    expect(res.includedFiles).toEqual(['a.ts', 'b.ts'])
    expect(res.diff).toContain('--- a.ts\n+line 1')
    expect(res.diff).toContain('--- b.ts\n+line 2')
  })

  it('超过限制时按文件块跳过，提示不进入 diff 预算', () => {
    const files = [
      { filename: 'a.ts', patch: '+first file patch content' },
      { filename: 'b.ts', patch: '+second file patch content' },
      { filename: 'c.ts', patch: '+third file patch content' },
    ]
    // 只够容纳第一个文件，容纳不下第二个文件
    const chunk1 = '--- a.ts\n+first file patch content'
    const res = formatDiffAndTruncate(files, chunk1.length + 5, 'zh')
    expect(res.truncated).toBe(true)
    expect(res.omittedCount).toBe(2)
    expect(res.includedFiles).toEqual(['a.ts'])
    expect(res.diff).toContain('--- a.ts')
    expect(res.diff).not.toContain('--- b.ts')
    expect(res.diff).toBe(chunk1)
    expect(res.diff.length).toBeLessThanOrEqual(chunk1.length + 5)
    expect(res.omittedFiles).toEqual(['b.ts', 'c.ts'])
  })

  it('首个大文件跳过后仍评审可放入预算的小文件', () => {
    const files = [
      { filename: 'big.ts', patch: '+'.repeat(1000) },
      { filename: 'small.ts', patch: '+ok' },
    ]
    const res = formatDiffAndTruncate(files, 20, 'en')
    expect(res.includedFiles).toEqual(['small.ts'])
    expect(res.omittedFiles).toEqual(['big.ts'])
    expect(res.diff).toBe('--- small.ts\n+ok')
    expect(res.diff.length).toBeLessThanOrEqual(20)
  })

  it('中间大文件被跳过后继续利用剩余预算', () => {
    const files = [
      { filename: 'a', patch: '+a' },
      { filename: 'big', patch: '+'.repeat(1000) },
      { filename: 'b', patch: '+b' },
    ]
    const res = formatDiffAndTruncate(files, 20)
    expect(res.includedFiles).toEqual(['a', 'b'])
    expect(res.omittedFiles).toEqual(['big'])
  })

  it('文件头和块间换行均纳入绝对预算', () => {
    const files = [
      { filename: 'a', patch: '+a' },
      { filename: 'b', patch: '+b' },
    ]
    const full = '--- a\n+a\n--- b\n+b'
    expect(formatDiffAndTruncate(files, full.length).diff).toBe(full)
    expect(formatDiffAndTruncate(files, full.length - 1).includedFiles).toEqual(['a'])
    expect(formatDiffAndTruncate(files, 0).diff).toBe('')
    expect(formatDiffAndTruncate(files, 2).omittedCount).toBe(2)
  })
})

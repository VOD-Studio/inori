import { describe, expect, it } from 'vitest'
import { shouldSkipByPaths, shouldSkipReview } from '../../src/core/skip'

describe('shouldSkipReview 智能早退 (Issue 3)', () => {
  it('草稿 PR 默认早退', () => {
    const res = shouldSkipReview({ isDraft: true, skipDraft: true, lang: 'zh' })
    expect(res.skip).toBe(true)
    expect(res.reason).toBe('跳过草稿 PR 评审')
  })

  it('skipDraft 为 false 时草稿 PR 不早退', () => {
    const res = shouldSkipReview({ isDraft: true, skipDraft: false })
    expect(res.skip).toBe(false)
  })

  it('识别 GitHub 官方 Bot 信号并早退', () => {
    // App 账号登录名带 "[bot]" 后缀(dependabot[bot]、renovate[bot] 等)
    expect(
      shouldSkipReview({
        author: { login: 'dependabot[bot]' },
        ignoreBots: true,
        lang: 'zh',
      }).skip,
    ).toBe(true)

    expect(
      shouldSkipReview({
        author: { login: 'renovate[bot]', type: 'Bot' },
        ignoreBots: true,
        lang: 'zh',
      }).skip,
    ).toBe(true)

    // 账号 type 标记为 Bot(如 GitHub App 代发)
    expect(
      shouldSkipReview({
        author: { login: 'custom-user', type: 'Bot' },
        ignoreBots: true,
        lang: 'en',
      }).reason,
    ).toBe('Skipping bot PR review (custom-user)')
  })

  it('真人账号不因启发式误伤', () => {
    // 不做 "-bot" 后缀等猜测:非官方 Bot 信号一律评审,
    // 需要跳过的自动化账号可显式列入 ignore_authors
    expect(
      shouldSkipReview({
        author: { login: 'renovate-bot', type: 'User' },
        ignoreBots: true,
      }).skip,
    ).toBe(false)

    expect(
      shouldSkipReview({
        author: { login: 'humans-with-bot-in-name', type: 'User' },
        ignoreBots: true,
      }).skip,
    ).toBe(false)
  })

  it('命中 ignoreAuthors 时早退', () => {
    const res = shouldSkipReview({
      author: { login: 'deploy-service' },
      ignoreAuthors: ['deploy-service', 'ci-runner'],
      lang: 'zh',
    })
    expect(res.skip).toBe(true)
    expect(res.reason).toContain('跳过指定作者 PR 评审')
  })

  it('正常开发者 PR 不早退', () => {
    const res = shouldSkipReview({
      isDraft: false,
      skipDraft: true,
      author: { login: 'octocat', type: 'User' },
      ignoreBots: true,
      ignoreAuthors: ['other-user'],
    })
    expect(res.skip).toBe(false)
  })
})

describe('shouldSkipByPaths 路径级整体跳过', () => {
  it('全部文件命中跳过路径时跳过', () => {
    const res = shouldSkipByPaths(['.github/workflows/ci.yml', '.github/inori.yml'], ['.github/**'])
    expect(res.skip).toBe(true)
    expect(res.reason).toContain('2 个变更文件')
  })

  it('存在未命中文件时不跳过（混合 PR 照常评审）', () => {
    const res = shouldSkipByPaths(
      ['.github/workflows/ci.yml', 'src/main.ts'],
      ['.github/**', 'docs/**'],
    )
    expect(res.skip).toBe(false)
  })

  it('裸文件名与目录内 glob 同 isIgnored 语义', () => {
    expect(shouldSkipByPaths(['CHANGELOG.md'], ['CHANGELOG.md']).skip).toBe(true)
    expect(shouldSkipByPaths(['docs/adr/0001.md'], ['docs/**']).skip).toBe(true)
  })

  it('未配置模式或空文件列表不跳过（交由空 diff 早退兜底）', () => {
    expect(shouldSkipByPaths(['.github/x.yml'], []).skip).toBe(false)
    expect(shouldSkipByPaths([], ['.github/**']).skip).toBe(false)
  })
})

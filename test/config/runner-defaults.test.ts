import * as core from '@actions/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readActionInputs } from '../../src/config/actionInputs'
import { resolveConfig } from '../../src/config/resolve'

// ── P0 回归:GitHub Actions runner 会把 action.yml 声明了 default 的
// input 注入 INPUT_* 环境变量(即使 workflow 未显式传参)。
// 本文件模拟 runner 注入与 action.yml 一致的「空串 default」,
// 验证配置文件与 DEFAULTS 的优先级在真实运行环境中成立。
// 历史缺陷:action.yml 曾给 language/on_update/max_diff_chars 等写非空
// default,导致 getInput 恒非空,.github/inori.yml 的同名字段被遮蔽、
// keep_previous_comments 兼容开关不可达。

/** 与修复后 action.yml 的 default 一致(可选 input 全部为空串) */
const RUNNER_DEFAULTS: Record<string, string> = {
  INPUT_PROVIDER: '',
  INPUT_LLM_ENDPOINT: '',
  INPUT_LLM_MODEL: '',
  INPUT_CODING_PLAN: '',
  INPUT_LANGUAGE: '',
  INPUT_IGNORE_PATTERNS: '',
  INPUT_CUSTOM_INSTRUCTIONS: '',
  INPUT_MAX_DIFF_CHARS: '',
  INPUT_MAX_BODY_CHARS: '',
  INPUT_ON_UPDATE: '',
  INPUT_KEEP_PREVIOUS_COMMENTS: '',
  INPUT_SKIP_DRAFT: '',
  INPUT_IGNORE_BOTS: '',
  INPUT_IGNORE_AUTHORS: '',
}

const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of Object.keys(RUNNER_DEFAULTS)) {
    savedEnv[key] = process.env[key]
    process.env[key] = RUNNER_DEFAULTS[key]
  }
})

afterAll(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key]
    else process.env[key] = val
  }
})

describe('runner 注入空串 default 时,配置文件优先级成立 (Issue 5 P0 回归)', () => {
  it('getInput 读到的是注入的空串,readActionInputs 透传空串', () => {
    expect(core.getInput('language')).toBe('')
    expect(core.getInput('on_update')).toBe('')
    expect(readActionInputs().language).toBe('')
    expect(readActionInputs().on_update).toBe('')
  })

  it('配置文件的 language/on_update/max_diff_chars/skip_draft/ignore_bots 生效', () => {
    const cfg = resolveConfig(readActionInputs(), {
      language: 'en',
      on_update: 'resolve',
      max_diff_chars: 99999,
      skip_draft: false,
      ignore_bots: false,
    })
    expect(cfg.language).toBe('en')
    expect(cfg.onUpdate).toBe('resolve')
    expect(cfg.maxDiffChars).toBe(99999)
    expect(cfg.skipDraft).toBe(false)
    expect(cfg.ignoreBots).toBe(false)
  })

  it('keep_previous_comments 兼容开关在 on_update 未设时可达 (Issue 2 P0 回归)', () => {
    process.env.INPUT_KEEP_PREVIOUS_COMMENTS = 'true'
    const cfg = resolveConfig(readActionInputs(), {})
    expect(cfg.onUpdate).toBe('keep')
    process.env.INPUT_KEEP_PREVIOUS_COMMENTS = ''
  })

  it('用户显式 with: 传入时仍优先于配置文件', () => {
    process.env.INPUT_LANGUAGE = 'en'
    process.env.INPUT_ON_UPDATE = 'keep'
    const cfg = resolveConfig(readActionInputs(), {
      language: 'zh',
      on_update: 'replace',
    })
    expect(cfg.language).toBe('en')
    expect(cfg.onUpdate).toBe('keep')
    process.env.INPUT_LANGUAGE = ''
    process.env.INPUT_ON_UPDATE = ''
  })
})

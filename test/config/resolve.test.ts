import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/config/defaults'
import { parseConfigFile, resolveConfig } from '../../src/config/resolve'
import { DEFAULT_PROVIDER } from '../../src/llm/providers'
import { inputs } from './helpers'

describe('batch configuration', () => {
  it('preserves the default total budget and limits concurrent reviews', () => {
    expect(resolveConfig(inputs())).toMatchObject({
      maxDiffChars: 40000,
      batchDiffChars: 40000,
      maxRequests: 4,
      reviewConcurrency: 1,
    })
  })

  it('uses action inputs before repository batch configuration', () => {
    const file = { batch_diff_chars: 500, max_requests: 7, review_concurrency: 3 }
    expect(resolveConfig(inputs(), file)).toMatchObject({
      batchDiffChars: 500,
      maxRequests: 7,
      reviewConcurrency: 3,
    })
    expect(
      resolveConfig(
        inputs({ batch_diff_chars: '200', max_requests: '2', review_concurrency: '1' }),
        file,
      ),
    ).toMatchObject({
      batchDiffChars: 200,
      maxRequests: 2,
      reviewConcurrency: 1,
    })
  })

  it.each(['0', '-1', '1.5', '2x', 'Infinity', '9007199254740992'])(
    'rejects invalid action integers: %s',
    (value) => {
      for (const key of ['batch_diff_chars', 'max_requests', 'review_concurrency']) {
        expect(() => resolveConfig(inputs({ [key]: value }))).toThrow()
      }
    },
  )

  it.each(['0', '-1', '1.5', '"2"', '.inf', 'null'])(
    'rejects invalid YAML integer values: %s',
    (value) => {
      for (const key of ['batch_diff_chars', 'max_requests', 'review_concurrency']) {
        expect(() => parseConfigFile(`${key}: ${value}`)).toThrow()
      }
    },
  )

  it('rejects concurrency above three in both sources', () => {
    expect(() => resolveConfig(inputs({ review_concurrency: '4' }))).toThrow()
    expect(() => parseConfigFile('review_concurrency: 4')).toThrow()
  })
})

describe('parseConfigFile', () => {
  it('解析有效 YAML 配置', () => {
    const yaml = `
language: en
max_diff_chars: 50000
on_update: resolve
skip_draft: false
ignore_bots: false
ignore_patterns:
  - "*.generated.ts"
  - "fixtures/**"
ignore_authors:
  - "bot-user"
custom_instructions: |
  No inline styles.
`
    const config = parseConfigFile(yaml)
    expect(config.language).toBe('en')
    expect(config.max_diff_chars).toBe(50000)
    expect(config.on_update).toBe('resolve')
    expect(config.skip_draft).toBe(false)
    expect(config.ignore_bots).toBe(false)
    expect(config.ignore_patterns).toEqual(['*.generated.ts', 'fixtures/**'])
    expect(config.ignore_authors).toEqual(['bot-user'])
    expect(config.custom_instructions).toContain('No inline styles.')
  })

  it('空文件和注释文件可使用默认配置', () => {
    expect(parseConfigFile('')).toEqual({})
    expect(parseConfigFile('# Repository preferences\n')).toEqual({})
  })

  it.each([
    ':::invalid',
    'null',
    '[]',
    'false',
    'language: [',
    'provider: 3',
    'ignore_patterns: [null]',
    'skip_draft: maybe',
    'max_diff_chars: 0',
    'max_body_chars: 65537',
  ])('拒绝非法配置 %s', (content) => {
    expect(() => parseConfigFile(content)).toThrow()
  })

  it('YAML 错误不暴露配置正文', () => {
    expect(() => parseConfigFile('secret-url: [https://private.invalid')).toThrow(
      'Repository configuration contains invalid YAML',
    )
  })
})

describe('resolveConfig 优先级：Action Inputs > 配置文件 > 内置默认值 (Issue 5)', () => {
  it('三层各取其一', () => {
    const fileConfig = {
      language: 'en' as const,
      max_diff_chars: 50000,
      custom_instructions: 'From file',
      on_update: 'resolve' as const,
    }

    const resolved = resolveConfig(
      inputs({
        language: 'zh', // 覆盖为 zh
        custom_instructions: 'From input', // 覆盖
      }),
      fileConfig,
    )

    expect(resolved.language).toBe('zh')
    expect(resolved.customInstructions).toBe('From input')
    expect(resolved.maxDiffChars).toBe(50000) // 继承自 file
    expect(resolved.maxBodyChars).toBe(DEFAULTS.maxBodyChars) // 继承默认值
    expect(resolved.onUpdate).toBe('resolve') // 继承自 file
  })

  it('ignore_patterns 合并默认与自定义', () => {
    const resolved = resolveConfig(inputs({ ignore_patterns: '*.test.ts, temp/*' }), {
      ignore_patterns: ['*.json'],
    })
    expect(resolved.ignorePatterns).toContain('pnpm-lock.yaml')
    expect(resolved.ignorePatterns).toContain('*.test.ts')
    expect(resolved.ignorePatterns).toContain('temp/*')
  })

  it('keep_previous_comments 向下兼容映射为 onUpdate: keep (Issue 2)', () => {
    const resolved = resolveConfig(inputs({ keep_previous_comments: 'true' }))
    expect(resolved.onUpdate).toBe('keep')

    const resolved2 = resolveConfig(inputs(), { keep_previous_comments: true })
    expect(resolved2.onUpdate).toBe('keep')
  })

  it('on_update 显式给出时优先于 keep_previous_comments', () => {
    const resolved = resolveConfig(inputs({ on_update: 'resolve', keep_previous_comments: 'true' }))
    expect(resolved.onUpdate).toBe('resolve')
  })

  it('未设置时全部回落到 DEFAULTS', () => {
    const resolved = resolveConfig(inputs())
    expect(resolved).toEqual({
      provider: undefined,
      providerName: undefined,
      llmEndpoint: DEFAULT_PROVIDER.defaultEndpoint,
      llmModel: DEFAULT_PROVIDER.defaultModel,
      isCustomEndpoint: false,
      codingPlan: DEFAULTS.codingPlan,
      language: DEFAULTS.language,
      ignorePatterns: expect.any(Array),
      pathsIgnore: DEFAULTS.pathsIgnore,
      ignoreCommitPrefixes: DEFAULTS.ignoreCommitPrefixes,
      customInstructions: DEFAULTS.customInstructions,
      maxDiffChars: DEFAULTS.maxDiffChars,
      batchDiffChars: DEFAULTS.batchDiffChars,
      maxRequests: DEFAULTS.maxRequests,
      reviewConcurrency: DEFAULTS.reviewConcurrency,
      maxBodyChars: DEFAULTS.maxBodyChars,
      onUpdate: DEFAULTS.onUpdate,
      skipDraft: DEFAULTS.skipDraft,
      ignoreBots: DEFAULTS.ignoreBots,
      ignoreAuthors: DEFAULTS.ignoreAuthors,
    })
    // 内置忽略清单始终生效
    expect(resolved.ignorePatterns).toContain('pnpm-lock.yaml')
    expect(resolved.ignorePatterns).toContain('*.min.js')
  })

  it('配置文件指定 provider（如 zhipu）自动推断 endpoint 与默认模型', () => {
    const resolved = resolveConfig(inputs(), { provider: 'zhipu' })
    expect(resolved.provider).toBe('zhipu')
    expect(resolved.llmEndpoint).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(resolved.llmModel).toBe('glm-4.7-flash')
    expect(resolved.codingPlan).toBe(true)
    expect(resolved.isCustomEndpoint).toBe(false)
  })

  it('Action Input 指定 provider 优先于配置文件', () => {
    const resolved = resolveConfig(inputs({ provider: 'qwen' }), { provider: 'zhipu' })
    expect(resolved.provider).toBe('dashscope')
    expect(resolved.llmEndpoint).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(resolved.llmModel).toBe('qwen-plus')
  })

  it('显式自定义 endpoint 优先级高于自动推断', () => {
    const resolved = resolveConfig(
      inputs({
        llm_endpoint: 'https://my-proxy.company.com/v1',
        llm_model: 'custom-model',
      }),
      { provider: 'zhipu' },
    )
    expect(resolved.llmEndpoint).toBe('https://my-proxy.company.com/v1')
    expect(resolved.llmModel).toBe('custom-model')
  })

  it.each([
    { on_update: 'nonsense' },
    { language: 'fr' },
    { max_diff_chars: 'abc' },
    { max_diff_chars: '1.5' },
    { max_diff_chars: '100x' },
    { max_diff_chars: '0' },
    { max_diff_chars: '-1' },
    { max_body_chars: '65537' },
    { coding_plan: 'yes' },
    { keep_previous_comments: 'yes' },
  ])('非法 inputs 不静默回落 %j', (invalid) => {
    expect(() => resolveConfig(inputs(invalid))).toThrow()
  })

  it('非法文件字段不因 input 覆盖而被忽略', () => {
    expect(() =>
      resolveConfig(inputs({ max_diff_chars: '500' }), {
        max_diff_chars: 'not-a-number' as never,
      }),
    ).toThrow()
  })
})

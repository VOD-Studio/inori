import type { ResolvedConfig } from './types'

// ── 内置默认值（单一事实来源）──
// action.yml 的可选 input 一律不写 default（由 runner 注入空串），
// 默认值只在这里定义，README 与 action.yml description 照此同步。
// 字段形状 Pick 自 ResolvedConfig（types.ts 唯一定义，含 Lang/OnUpdate
// 领域约束）；新增配置项：types.ts 加字段 → 此处加默认值 → resolve.ts 加一行合并。
// LLM 默认 provider/endpoint/model 不在此列——事实来源在
// llm/providers.ts 的 DEFAULT_PROVIDER（自动推断引擎的兜底预设）。

/** 需要内置默认值的 ResolvedConfig 字段（LLM 三项由 providers.ts 推断） */
type DefaultFields = Pick<
  ResolvedConfig,
  | 'codingPlan'
  | 'language'
  | 'maxDiffChars'
  | 'maxBodyChars'
  | 'onUpdate'
  | 'skipDraft'
  | 'ignoreBots'
  | 'ignoreAuthors'
  | 'ignorePatterns'
  | 'customInstructions'
>

export const DEFAULTS = {
  codingPlan: true,
  language: 'zh',
  maxDiffChars: 40000,
  maxBodyChars: 60000,
  onUpdate: 'replace',
  skipDraft: true,
  ignoreBots: true,
  ignoreAuthors: [] as string[],
  ignorePatterns: [] as string[],
  customInstructions: '',
} as const satisfies DefaultFields

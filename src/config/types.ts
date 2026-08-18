import type { Lang } from '../core/i18n'

// ── 配置层类型 ──
// 三层来源：Action Inputs（显式 with:）> .github/inori.yml > DEFAULTS。
// ActionInputs 恒为原始字符串（空串 = 未设置）；InoriConfig 为配置文件
// 解析结果；ResolvedConfig 为最终生效配置，字段全部非可选（除可选的 provider 标记）。

/** re-review 时对上一轮 inline 评论的处理策略 */
export type OnUpdate = 'replace' | 'resolve' | 'keep'

export const ON_UPDATE_VALUES: readonly OnUpdate[] = ['replace', 'resolve', 'keep']

/** 从 INPUT_* 环境变量读到的原始 action inputs（空串 = 未设置） */
export interface ActionInputs {
  provider: string
  llm_endpoint: string
  llm_model: string
  coding_plan: string
  language: string
  ignore_patterns: string
  custom_instructions: string
  max_diff_chars: string
  max_body_chars: string
  on_update: string
  keep_previous_comments: string
  skip_draft: string
  ignore_bots: string
  ignore_authors: string
}

/** .github/inori.yml 的可识别字段（全部可选） */
export interface InoriConfig {
  provider?: string
  llm_endpoint?: string
  llm_model?: string
  coding_plan?: boolean
  language?: Lang
  ignore_patterns?: string[] | string
  custom_instructions?: string
  max_diff_chars?: number
  max_body_chars?: number
  on_update?: OnUpdate
  keep_previous_comments?: boolean
  skip_draft?: boolean
  ignore_bots?: boolean
  ignore_authors?: string[] | string
}

/** 最终生效配置（字段全部就绪，消费方直接使用） */
export interface ResolvedConfig {
  /** 识别或指定的 Provider ID */
  provider?: string
  /** Provider 友好显示名称 */
  providerName?: string
  /** 最终生效的 LLM API Endpoint */
  llmEndpoint: string
  /** 最终生效的 LLM Model 名称 */
  llmModel: string
  /** endpoint 是否由用户显式自定义（false = 预设或自动推断填充） */
  isCustomEndpoint: boolean
  /** 是否启用 Coding Plan / 结构化修复计划模式 */
  codingPlan: boolean
  language: Lang
  ignorePatterns: string[]
  customInstructions: string
  maxDiffChars: number
  maxBodyChars: number
  onUpdate: OnUpdate
  skipDraft: boolean
  ignoreBots: boolean
  ignoreAuthors: string[]
}

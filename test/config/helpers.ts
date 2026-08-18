import type { ActionInputs } from '../../src/config'

/** 构造 action inputs:未给字段一律为空串(等价于 runner 注入「未设置」) */
export function inputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    provider: '',
    llm_endpoint: '',
    llm_model: '',
    coding_plan: '',
    language: '',
    ignore_patterns: '',
    custom_instructions: '',
    max_diff_chars: '',
    max_body_chars: '',
    on_update: '',
    keep_previous_comments: '',
    skip_draft: '',
    ignore_bots: '',
    ignore_authors: '',
    ...overrides,
  }
}

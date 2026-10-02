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
    paths_ignore: '',
    ignore_commit_prefixes: '',
    custom_instructions: '',
    max_diff_chars: '',
    batch_diff_chars: '',
    max_requests: '',
    review_concurrency: '',
    max_body_chars: '',
    on_update: '',
    keep_previous_comments: '',
    skip_draft: '',
    ignore_bots: '',
    ignore_authors: '',
    ...overrides,
  }
}

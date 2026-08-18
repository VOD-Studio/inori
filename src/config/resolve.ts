import YAML from 'yaml'
import { DEFAULT_IGNORE_PATTERNS } from '../core/diff'
import { resolveLlmEndpointAndModel } from '../llm/providers'
import { DEFAULTS } from './defaults'
import type { ActionInputs, InoriConfig, OnUpdate, ResolvedConfig } from './types'
import { ON_UPDATE_VALUES } from './types'

// ── 配置文件解析与三层合并 ──
// 优先级：Action Inputs（显式传入）> 配置文件 > DEFAULTS。

/** 解析 YAML 配置文件内容；非法内容容错返回空对象 */
export function parseConfigFile(content: string): InoriConfig {
  try {
    const parsed = YAML.parse(content)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as InoriConfig
  } catch {
    return {}
  }
}

/** 字符串或数组统一拆为去空白后的非空列表 */
export function parseStringList(val: string[] | string | undefined): string[] {
  if (!val) return []
  if (Array.isArray(val)) {
    return val.map((s) => String(s).trim()).filter(Boolean)
  }
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// —— 字段级合并 helpers：input 显式值 > 文件值 > 默认值 ——

/** input 非空白则用之，否则文件值，再否则默认值 */
function strField(raw: string, file: string | undefined, def: string): string {
  return raw.trim() !== '' ? raw : (file ?? def)
}

/** input 恒为字符串："true"→true，"false"→false，其余值（含空）落到文件/默认 */
function boolField(raw: string, file: boolean | undefined, def: boolean): boolean {
  const v = raw.trim().toLowerCase()
  if (v === 'true') return true
  if (v === 'false') return false
  return file ?? def
}

/** input 是可解析整数则用之，否则文件值（须为数字），再否则默认值 */
function intField(raw: string, file: number | undefined, def: number): number {
  const v = raw.trim()
  if (v !== '') {
    const n = parseInt(v, 10)
    if (!Number.isNaN(n)) return n
  }
  return typeof file === 'number' ? file : def
}

/** input 是合法枚举值则用之，否则文件值（归一后校验），再否则默认值 */
function enumField<T extends string>(
  raw: string,
  allowed: readonly T[],
  file: string | undefined,
  def: T,
): T {
  const normalize = (v: string): T | null => {
    const n = v.trim().toLowerCase() as T
    return (allowed as readonly string[]).includes(n) ? n : null
  }
  if (raw.trim() !== '') {
    const n = normalize(raw)
    if (n !== null) return n
  }
  if (file !== undefined) {
    const n = normalize(String(file))
    if (n !== null) return n
  }
  return def
}

/** 列表：input 非空列表优先，否则文件列表（默认值由调用方决定拼接方式） */
function listField(raw: string, file: string[] | string | undefined): string[] {
  const fromInput = parseStringList(raw)
  return fromInput.length > 0 ? fromInput : parseStringList(file)
}

/**
 * 合并三层配置为最终生效值。
 * 包含模型与 Provider 自动推断、Coding Plan 模式判断及三层配置优先级合并。
 */
export function resolveConfig(inputs: ActionInputs, fileConfig: InoriConfig = {}): ResolvedConfig {
  // 1. Coding Plan 开关
  const codingPlan = boolField(inputs.coding_plan, fileConfig.coding_plan, DEFAULTS.codingPlan)

  // 2. Provider / Endpoint / Model 解析与自动推断
  const rawProvider = strField(inputs.provider, fileConfig.provider, '')
  const rawEndpoint = strField(inputs.llm_endpoint, fileConfig.llm_endpoint, '')
  const rawModel = strField(inputs.llm_model, fileConfig.llm_model, '')

  const llmResolved = resolveLlmEndpointAndModel({
    provider: rawProvider,
    endpoint: rawEndpoint,
    model: rawModel,
  })

  // 3. language
  const language = enumField(inputs.language, ['zh', 'en'], fileConfig.language, DEFAULTS.language)

  // 4. ignorePatterns: 内置默认 + 用户显式追加（input 优先于文件）
  const extraPatterns = listField(inputs.ignore_patterns, fileConfig.ignore_patterns)
  const ignorePatterns = Array.from(new Set([...DEFAULT_IGNORE_PATTERNS, ...extraPatterns]))

  // 4b. pathsIgnore: 纯此类变更的 PR 整体跳过（不与内置默认合并，
  //     未配置即不启用——与 ignorePatterns 语义正交）
  const pathsIgnore = listField(inputs.paths_ignore, fileConfig.paths_ignore)

  // 4c. ignoreCommitPrefixes: PR 全部 commit 的 subject 命中前缀时整体跳过
  const ignoreCommitPrefixes = listField(
    inputs.ignore_commit_prefixes,
    fileConfig.ignore_commit_prefixes,
  )

  // 5. customInstructions: 非空 input > 文件 > 空
  const customInstructions = strField(
    inputs.custom_instructions,
    fileConfig.custom_instructions,
    DEFAULTS.customInstructions,
  )

  const maxDiffChars = intField(
    inputs.max_diff_chars,
    fileConfig.max_diff_chars,
    DEFAULTS.maxDiffChars,
  )

  const maxBodyChars = intField(
    inputs.max_body_chars,
    fileConfig.max_body_chars,
    DEFAULTS.maxBodyChars,
  )

  // 6. onUpdate: on_update 显式 > keep_previous_comments legacy > 文件 > 默认
  let onUpdate = enumField(
    inputs.on_update,
    ON_UPDATE_VALUES,
    fileConfig.on_update,
    DEFAULTS.onUpdate,
  )
  if (inputs.on_update.trim() === '') {
    const legacyInput = inputs.keep_previous_comments.trim().toLowerCase() === 'true'
    const legacyFile = fileConfig.keep_previous_comments === true
    if (legacyInput || legacyFile) onUpdate = 'keep' satisfies OnUpdate
  }

  const skipDraft = boolField(inputs.skip_draft, fileConfig.skip_draft, DEFAULTS.skipDraft)
  const ignoreBots = boolField(inputs.ignore_bots, fileConfig.ignore_bots, DEFAULTS.ignoreBots)
  const ignoreAuthors = listField(inputs.ignore_authors, fileConfig.ignore_authors)

  return {
    provider: llmResolved.provider,
    providerName: llmResolved.providerName,
    llmEndpoint: llmResolved.endpoint,
    llmModel: llmResolved.model,
    isCustomEndpoint: llmResolved.isCustomEndpoint,
    codingPlan,
    language,
    ignorePatterns,
    pathsIgnore,
    ignoreCommitPrefixes,
    customInstructions,
    maxDiffChars,
    maxBodyChars,
    onUpdate,
    skipDraft,
    ignoreBots,
    ignoreAuthors,
  }
}

import { readActionInputs } from './actionInputs'
import { resolveConfig } from './resolve'
import type { InoriConfig, ResolvedConfig } from './types'

// ── 配置层对外唯一入口 ──
// 仓库配置由 GitHub 适配层从固定 base SHA 读取。

/** 读取并合并全部配置（Action Inputs > .github/inori.yml > DEFAULTS） */
export function loadConfig(fileConfig: InoriConfig): ResolvedConfig {
  return resolveConfig(readActionInputs(), fileConfig)
}

export { DEFAULTS } from './defaults'
export { parseConfigFile, parseStringList, resolveConfig } from './resolve'
export type { ActionInputs, InoriConfig, OnUpdate, ResolvedConfig } from './types'
export { ON_UPDATE_VALUES } from './types'

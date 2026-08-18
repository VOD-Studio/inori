import { readActionInputs } from './actionInputs'
import { loadRepoConfigFile } from './repoConfig'
import { resolveConfig } from './resolve'
import type { ResolvedConfig } from './types'

// ── 配置层对外唯一入口 ──
// 调用方（index.ts）只需要 loadConfig()：背后是
// action inputs 读取 → 仓库配置文件读取 → 三层合并。

/** 读取并合并全部配置（Action Inputs > .github/inori.yml > DEFAULTS） */
export function loadConfig(): ResolvedConfig {
  return resolveConfig(readActionInputs(), loadRepoConfigFile())
}

export { DEFAULTS } from './defaults'
export { parseConfigFile, parseStringList, resolveConfig } from './resolve'
export type { ActionInputs, InoriConfig, OnUpdate, ResolvedConfig } from './types'
export { ON_UPDATE_VALUES } from './types'

import * as core from "@actions/core";
import type { ActionInputs } from "./types";

// ── Action Inputs 读取 ──
// GitHub Actions runner 对 action.yml 声明了 default 的 input 会注入
// INPUT_* 环境变量（即使 workflow 未显式传参），因此这里约定：
// 可选 input 在 action.yml 中不设 default，runner 注入空串，
// 空串一律视为「未设置」，让配置文件与 DEFAULTS 有机会生效。

/** 读取全部评审相关 inputs（必填的 llm_* 与 github_token 不在此列） */
export function readActionInputs(): ActionInputs {
  return {
    language: core.getInput("language"),
    ignore_patterns: core.getInput("ignore_patterns"),
    custom_instructions: core.getInput("custom_instructions"),
    max_diff_chars: core.getInput("max_diff_chars"),
    max_body_chars: core.getInput("max_body_chars"),
    on_update: core.getInput("on_update"),
    keep_previous_comments: core.getInput("keep_previous_comments"),
    skip_draft: core.getInput("skip_draft"),
    ignore_bots: core.getInput("ignore_bots"),
    ignore_authors: core.getInput("ignore_authors"),
  };
}

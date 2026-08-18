import type { OnUpdate } from "./types";

// ── 内置默认值（单一事实来源）──
// action.yml 的可选 input 一律不写 default（由 runner 注入空串），
// 默认值只在这里定义，README 与 action.yml description 照此同步。
// 新增配置项：types.ts 加字段 → 此处加默认值 → resolve.ts 加一行合并。

export const DEFAULTS = {
  provider: "deepseek",
  llmEndpoint: "https://api.deepseek.com/v1",
  llmModel: "deepseek-chat",
  codingPlan: true,
  language: "zh",
  maxDiffChars: 40000,
  maxBodyChars: 60000,
  onUpdate: "replace",
  skipDraft: true,
  ignoreBots: true,
  ignoreAuthors: [] as string[],
  ignorePatterns: [] as string[],
  customInstructions: "",
} as const satisfies {
  provider: string;
  llmEndpoint: string;
  llmModel: string;
  codingPlan: boolean;
  language: string;
  maxDiffChars: number;
  maxBodyChars: number;
  onUpdate: OnUpdate;
  skipDraft: boolean;
  ignoreBots: boolean;
  ignoreAuthors: string[];
  ignorePatterns: string[];
  customInstructions: string;
};

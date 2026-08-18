// ── 大模型提供商预设与自动推断引擎 ──
// 支持通过 provider 名称、别名或模型名前缀自动补全 endpoint 与推荐模型，
// 同时 100% 支持用户自定义 endpoint 与 model（显式配置永远优先）。
//
// ⚠️ defaultModel 是「快照值」，各平台模型目录迭代快（火山方舟等按月滚动），
// 未显式配置 llm_model 时才会用到。生产环境建议显式指定模型。
// 验证状态（2026-08-18，对照官方文档）：
//   已验证：deepseek/moonshot/dashscope/volcengine/github-models/openai/anthropic
//   端点探测通过（401/400 = 路径存在）：zhipu/siliconflow/baidu/tencent/lingyi/
//     stepfun/baichuan/infinigence/minimax
//   未验证（保留快照）：groq/mistral/perplexity/openrouter/together/fireworks/
//     ollama/local 及各家的 defaultModel 明细

export interface ProviderPreset {
  /** 唯一标准标识符（全小写） */
  id: string;
  /** 提供商展示名称 */
  name: string;
  /** 默认 API 基础端点（OpenAI 兼容 /chat/completions） */
  defaultEndpoint: string;
  /** 默认推荐通用模型 */
  defaultModel: string;
  /** 常见别名，用户输入时自动归一化 */
  aliases?: string[];
  /** 用于从模型名称自动推断所属 Provider 的正则模式 */
  modelPatterns?: RegExp[];
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  // ── 1. DeepSeek ──
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultEndpoint: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    aliases: ["deepseek-ai", "deep-seek"],
    modelPatterns: [/^deepseek-(chat|reasoner|coder|v\d)/i, /^deepseek$/i],
  },
  // ── 2. OpenAI ──
  {
    id: "openai",
    name: "OpenAI",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    aliases: ["chatgpt"],
    modelPatterns: [/^(gpt-|o1|o3|chatgpt)/i],
  },
  // ── 3. 智谱 AI (Zhipu / BigModel / GLM / CodeGeeX / Coding Plan) ──
  {
    id: "zhipu",
    name: "智谱 AI (GLM / CodeGeeX)",
    defaultEndpoint: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    aliases: ["bigmodel", "zhipuai", "glm", "codegeex"],
    modelPatterns: [/^(glm-|codegeex)/i],
  },
  // ── 4. 阿里云百炼 / 通义千问 (DashScope / Qwen / Coding Plan) ──
  {
    id: "dashscope",
    name: "阿里云百炼 (通义千问 / Qwen)",
    defaultEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    aliases: ["qwen", "aliyun", "tongyi", "alibaba", "bailian"],
    modelPatterns: [/^(qwen-|qwen2\.|qwen2\.5-|tongyi)/i],
  },
  // ── 5. 硅基流动 (SiliconFlow) ──
  {
    id: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    defaultEndpoint: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    aliases: ["silicon", "silicon-flow"],
    modelPatterns: [/^deepseek-ai\//i, /^Qwen\/Qwen2\.5-Coder/i, /^internlm\//i, /^Pro\/deepseek/i],
  },
  // ── 6. Moonshot AI (Kimi) ──
  {
    id: "moonshot",
    name: "Moonshot AI (Kimi)",
    defaultEndpoint: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    aliases: ["kimi", "moonshotai"],
    modelPatterns: [/^(moonshot|kimi)/i],
  },
  // ── 7. 字节跳动火山方舟 (Volcengine Ark / 豆包 Doubao) ──
  {
    id: "volcengine",
    name: "字节跳动火山引擎 (豆包 / Doubao)",
    defaultEndpoint: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-lite-260428",
    aliases: ["doubao", "volces", "bytedance", "huoshan"],
    modelPatterns: [/^(doubao|ep-)/i],
  },
  // ── 8. MiniMax (海螺 AI / Coding Plan) ──
  {
    id: "minimax",
    name: "MiniMax (海螺 AI)",
    defaultEndpoint: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    aliases: ["hailuo", "abab"],
    modelPatterns: [/^(minimax|abab)/i],
  },
  // ── 9. 百度千帆 (Baidu Qianfan / 文心一言) ──
  {
    id: "baidu",
    name: "百度智能云千帆",
    defaultEndpoint: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-turbo-8k",
    aliases: ["qianfan", "ernie", "wenxin"],
    modelPatterns: [/^(ernie|eb-)/i],
  },
  // ── 10. 腾讯混元 (Tencent Hunyuan) ──
  {
    id: "tencent",
    name: "腾讯混元 (Tencent Hunyuan)",
    defaultEndpoint: "https://api.hunyuan.cloud.tencent.com/v1",
    defaultModel: "hunyuan-standard",
    aliases: ["hunyuan", "tencentcloud"],
    modelPatterns: [/^hunyuan/i],
  },
  // ── 11. 零一万物 (01.AI / Yi) ──
  {
    id: "lingyi",
    name: "零一万物 (01.AI / Yi)",
    defaultEndpoint: "https://api.lingyiwanwu.com/v1",
    defaultModel: "yi-lightning",
    aliases: ["01.ai", "yi", "lingyiwanwu"],
    modelPatterns: [/^yi-/i],
  },
  // ── 12. 阶跃星辰 (StepFun) ──
  {
    id: "stepfun",
    name: "阶跃星辰 (StepFun)",
    defaultEndpoint: "https://api.stepfun.com/v1",
    defaultModel: "step-1-8k",
    aliases: ["step", "jieyue"],
    modelPatterns: [/^step-/i],
  },
  // ── 13. 百川智能 (Baichuan) ──
  {
    id: "baichuan",
    name: "百川智能 (Baichuan)",
    defaultEndpoint: "https://api.baichuan-ai.com/v1",
    defaultModel: "Baichuan4",
    aliases: ["baichuan-ai"],
    modelPatterns: [/^baichuan/i],
  },
  // ── 14. 无问芯穹 (Infinigence AI / GenStudio) ──
  {
    id: "infinigence",
    name: "无问芯穹 (Infinigence AI)",
    defaultEndpoint: "https://cloud.infini-ai.com/maas/v1",
    defaultModel: "deepseek-v3",
    aliases: ["infini", "genstudio"],
    modelPatterns: [],
  },
  // ── 15. Anthropic (Claude / 兼容代理) ──
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    defaultEndpoint: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    aliases: ["claude"],
    modelPatterns: [/^claude/i],
  },
  // ── 16. OpenRouter ──
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    aliases: ["open-router"],
    modelPatterns: [/^openrouter\//i],
  },
  // ── 17. Groq ──
  {
    id: "groq",
    name: "Groq",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    aliases: [],
    modelPatterns: [/^(llama-|mixtral-|gemma-)/i],
  },
  // ── 18. GitHub Models (Azure AI) ──
  {
    id: "github-models",
    name: "GitHub Models",
    defaultEndpoint: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4o-mini",
    aliases: ["github", "gh-models"],
    modelPatterns: [],
  },
  // ── 19. Together AI ──
  {
    id: "together",
    name: "Together AI",
    defaultEndpoint: "https://api.together.xyz/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    aliases: ["together-ai", "togetherai"],
    modelPatterns: [/^meta-llama\//i, /^togethercomputer\//i],
  },
  // ── 20. Fireworks AI ──
  {
    id: "fireworks",
    name: "Fireworks AI",
    defaultEndpoint: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/deepseek-v3",
    aliases: ["fireworks-ai"],
    modelPatterns: [/^accounts\/fireworks\//i],
  },
  // ── 21. Mistral AI ──
  {
    id: "mistral",
    name: "Mistral AI",
    defaultEndpoint: "https://api.mistral.ai/v1",
    defaultModel: "codestral-latest",
    aliases: ["mistralai", "codestral"],
    modelPatterns: [/^(mistral|codestral|pixtral)/i],
  },
  // ── 22. Perplexity AI ──
  {
    id: "perplexity",
    name: "Perplexity",
    defaultEndpoint: "https://api.perplexity.ai",
    defaultModel: "sonar",
    aliases: ["pplx"],
    modelPatterns: [/^sonar/i],
  },
  // ── 23. Ollama (本地 / 私有化部署) ──
  {
    id: "ollama",
    name: "Ollama (Local / Self-hosted)",
    defaultEndpoint: "http://localhost:11434/v1",
    defaultModel: "llama3",
    aliases: ["local-ollama"],
    modelPatterns: [/^ollama\//i],
  },
  // ── 24. vLLM / LMStudio / 通用本地服务 ──
  {
    id: "local",
    name: "Local OpenAI-Compatible Server (vLLM / LMStudio)",
    defaultEndpoint: "http://localhost:8000/v1",
    defaultModel: "default",
    aliases: ["vllm", "lmstudio", "custom-local"],
    modelPatterns: [],
  },
];

/** 未识别 provider 且无显式 endpoint/model 时的兜底预设（DeepSeek） */
export const DEFAULT_PROVIDER = PROVIDER_PRESETS[0];

/**
 * 根据输入名称或别名查找匹配的 Provider 预设
 */
export function findProvider(nameOrAlias: string | undefined): ProviderPreset | undefined {
  if (!nameOrAlias) return undefined;
  const raw = nameOrAlias.trim().toLowerCase();
  if (!raw) return undefined;

  return PROVIDER_PRESETS.find(
    (p) => p.id === raw || (p.aliases && p.aliases.some((a) => a.toLowerCase() === raw))
  );
}

/**
 * 根据模型名称特征模式自动推断所属 Provider 预设
 */
export function detectProviderByModel(modelName: string | undefined): ProviderPreset | undefined {
  if (!modelName) return undefined;
  const trimmed = modelName.trim();
  if (!trimmed) return undefined;

  for (const preset of PROVIDER_PRESETS) {
    if (preset.modelPatterns && preset.modelPatterns.some((pattern) => pattern.test(trimmed))) {
      return preset;
    }
  }
  return undefined;
}

export interface ResolveLlmResult {
  /** 最终生效的 API endpoint */
  endpoint: string;
  /** 最终生效的模型名称 */
  model: string;
  /** 识别出的 Provider ID（若匹配到预设） */
  provider?: string;
  /** 识别出的 Provider 友好名称 */
  providerName?: string;
  /** 是否由用户显式自定义了 endpoint */
  isCustomEndpoint: boolean;
}

export interface ResolveLlmInput {
  /** 显式指定的提供商（如 deepseek, zhipu, qwen, openai 等） */
  provider?: string;
  /** 显式指定的 API Endpoint */
  endpoint?: string;
  /** 显式指定的模型名称 */
  model?: string;
}

/**
 * 解析并自动补全 LLM Endpoint 与 Model 配置：
 * 1. 显式 endpoint 优先级最高（支持完全自定义）；
 * 2. 若指定 provider，自动使用其默认 endpoint 与模型；
 * 3. 若未指定 provider 但指定了 model，通过模型特征自动推断所属 provider 及对应 endpoint；
 * 4. 若均未指定，默认回退到 DeepSeek 官方预设。
 */
export function resolveLlmEndpointAndModel(input: ResolveLlmInput = {}): ResolveLlmResult {
  const explicitEndpoint = input.endpoint ? input.endpoint.trim().replace(/\/+$/, "") : "";
  const explicitModel = input.model ? input.model.trim() : "";
  const explicitProvider = input.provider ? input.provider.trim() : "";

  // 1. 显式通过 provider 查找
  let matchedPreset = findProvider(explicitProvider);

  // 2. 若无 provider 但有 model，尝试通过 modelName 推断 provider
  if (!matchedPreset && explicitModel) {
    matchedPreset = detectProviderByModel(explicitModel);
  }

  // 3. 最终默认 Provider（默认 DeepSeek）
  const effectivePreset = matchedPreset ?? DEFAULT_PROVIDER;

  // 确定 endpoint
  const endpoint = explicitEndpoint || effectivePreset.defaultEndpoint;
  const isCustomEndpoint = Boolean(explicitEndpoint && explicitEndpoint !== effectivePreset.defaultEndpoint);

  // 确定 model
  let model = explicitModel;
  if (!model) {
    model = effectivePreset.defaultModel;
  }

  return {
    endpoint,
    model,
    provider: matchedPreset?.id,
    providerName: matchedPreset?.name,
    isCustomEndpoint,
  };
}

/** 各 Provider 对应的专属 API Key 环境变量名（未列出的 provider 无专属变量） */
export const PROVIDER_ENV_KEYS: Readonly<Record<string, string>> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  volcengine: "VOLCENGINE_API_KEY",
  minimax: "MINIMAX_API_KEY",
  baidu: "QIANFAN_API_KEY",
  tencent: "HUNYUAN_API_KEY",
  lingyi: "YI_API_KEY",
  stepfun: "STEPFUN_API_KEY",
  baichuan: "BAICHUAN_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  "github-models": "GITHUB_TOKEN",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
};

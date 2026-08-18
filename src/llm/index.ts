import * as core from "@actions/core";
import { buildPrompt } from "../core/prompt";
import { isRetryableLlmError, LlmHttpError } from "../core/errors";
import type { ResolvedConfig } from "../config";
import { DEFAULT_PROVIDER, PROVIDER_ENV_KEYS } from "./providers";

// ── LLM 调用（OpenAI 兼容 /chat/completions）──

export interface LlmSettings {
  endpoint: string;
  model: string;
  apiKey: string;
  /** 单次调用上限，端点挂起时及时中止而不是卡满整个 job */
  timeoutMs: number;
  /** 429/5xx/超时/网络错误的退避重试次数 */
  maxRetries: number;
}

/** 异步等待毫秒数，遵循 Promise.withResolvers 规范 */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * 订阅套餐 key 防呆：各平台套餐 key 与按量计费 key/端点不互通（官方文档明示）。
 * 混用结局：报 invalid_api_key，或不抵扣订阅额度直接按量扣费——都是花冤枉钱。
 * - 阿里百炼：套餐 key 前缀 sk-sp-，套餐端点 coding.dashscope.aliyuncs.com
 * - MiniMax：订阅 key 前缀 sk-cp-，与按量共用端点 api.minimaxi.com（仅 key 区分）
 */
function warnCodingPlanMismatch(config: ResolvedConfig, apiKey: string): void {
  // 阿里：key 前缀与端点双判别
  const aliCodingEndpoint = config.llmEndpoint.includes("coding.dashscope.aliyuncs.com");
  const aliPayAsYouGo = config.llmEndpoint.includes("dashscope.aliyuncs.com") && !aliCodingEndpoint;
  const aliCodingKey = apiKey.startsWith("sk-sp-");
  if (aliCodingKey && aliPayAsYouGo) {
    core.warning(
      "检测到阿里 Coding Plan API Key（sk-sp-）但端点是按量计费端点（dashscope.aliyuncs.com）。两者不互通：该调用将返回 invalid_api_key。如需套餐抵扣请改用 provider: qwen-coding（https://coding.dashscope.aliyuncs.com/v1）"
    );
  } else if (!aliCodingKey && aliCodingEndpoint) {
    core.warning(
      "端点是阿里 Coding Plan 套餐端点（coding.dashscope.aliyuncs.com）但 key 不是套餐格式（sk-sp-）。两者不互通：通用 key 调用套餐端点将返回 invalid_api_key，且不会抵扣套餐额度"
    );
  }

  // MiniMax：套餐与按量共用端点，只能靠 key 前缀判别
  if (apiKey.startsWith("sk-cp-") && !config.llmEndpoint.includes("minimaxi.com")) {
    core.warning(
      "检测到 MiniMax Token Plan 订阅 Key（sk-cp-）但端点不是 api.minimaxi.com。订阅 Key 与其他平台/按量计费体系不互通，该调用将失败。MiniMax（含订阅）请使用 provider: minimax 或 minimax-token（https://api.minimaxi.com/v1）"
    );
  }
}

/**
 * 根据已解析配置（含自动推断与自定义）与环境密钥构造 LLM 调用设置。
 * API Key 查找顺序：llm_api_key input > 推断 provider 的专属环境变量
 * （如 ZHIPU_API_KEY）> 通用 LLM_API_KEY > 默认 provider（deepseek）专属变量。
 * 不做跨 provider 乱序兜底，避免拿 A 家的 key 打 B 家端点。
 */
export function readLlmSettings(config: ResolvedConfig): LlmSettings {
  let apiKey = core.getInput("llm_api_key");
  if (!apiKey && config.provider) {
    apiKey = process.env[PROVIDER_ENV_KEYS[config.provider]] ?? "";
  }
  if (!apiKey) {
    apiKey = process.env.LLM_API_KEY || "";
  }
  if (!apiKey) {
    const defaultEnvKey = PROVIDER_ENV_KEYS[DEFAULT_PROVIDER.id];
    apiKey = defaultEnvKey ? process.env[defaultEnvKey] || "" : "";
  }

  if (!apiKey) {
    const hint = config.provider
      ? `（当前 provider: ${config.providerName ?? config.provider}，可设置 ${PROVIDER_ENV_KEYS[config.provider] ?? "LLM_API_KEY"}）`
      : "（可设置 LLM_API_KEY 或 DEEPSEEK_API_KEY）";
    throw new Error(`缺少 LLM API Key：请在 Action with 中配置 llm_api_key 或设置环境变量${hint}`);
  }

  warnCodingPlanMismatch(config, apiKey);
  return {
    endpoint: config.llmEndpoint.replace(/\/+$/, ""),
    model: config.llmModel,
    apiKey,
    timeoutMs: 300_000,
    maxRetries: 3,
  };
}

/** 单次调用 OpenAI 兼容的 /chat/completions 接口，非 2xx 抛 LlmHttpError */
async function chatCompletions(settings: LlmSettings, body: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${settings.endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    throw new LlmHttpError(resp.status, detail);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM 响应结构异常: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return content.trim();
}

/**
 * 调用 LLM 产出评审内容：
 * - 结合 Coding Plan 约束构造 Prompt；
 * - 部分兼容端点不支持 response_format（通常报 400），自动去掉该参数重试一次；
 * - 429/5xx/超时/网络错误按指数退避重试，最多 maxRetries 次。
 */
export async function callLlm(diff: string, config: ResolvedConfig, settings: LlmSettings): Promise<string> {
  const prompt = buildPrompt(diff, config.language, config.customInstructions, config.codingPlan);
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  };

  let droppedResponseFormat = false;
  let attempt = 0;
  for (;;) {
    try {
      return await chatCompletions(settings, body);
    } catch (e) {
      if (e instanceof LlmHttpError && e.status === 400 && !droppedResponseFormat) {
        droppedResponseFormat = true;
        delete body.response_format;
        core.warning("端点可能不支持 response_format，已去掉该参数重试");
        continue;
      }
      attempt += 1;
      if (attempt > settings.maxRetries || !isRetryableLlmError(e)) throw e;
      const delayMs = 1000 * 2 ** attempt;
      core.warning(
        `LLM 调用失败：${e instanceof Error ? e.message : String(e)}，${delayMs / 1000}s 后重试（${attempt}/${settings.maxRetries}）`
      );
      await delay(delayMs);
    }
  }
}

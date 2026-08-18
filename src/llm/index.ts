import * as core from "@actions/core";
import { buildPrompt } from "../core/prompt";
import { isRetryableLlmError, LlmHttpError } from "../core/errors";
import type { ResolvedConfig } from "../config";

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
 * 根据已解析配置（含自动推断与自定义）与环境密钥构造 LLM 调用设置
 */
export function readLlmSettings(config: ResolvedConfig): LlmSettings {
  // 优先从 llm_api_key 读取，若为空可从常见环境变量兜底
  let apiKey = core.getInput("llm_api_key");
  if (!apiKey) {
    apiKey =
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.ZHIPU_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      "";
  }

  if (!apiKey) {
    throw new Error(
      "缺少 LLM API Key：请在 Action with 中配置 llm_api_key 或设置 secrets/环境变量"
    );
  }

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

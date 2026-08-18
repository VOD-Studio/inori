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

/** 读取必填的 LLM action inputs 与内置调用参数 */
export function readLlmSettings(): LlmSettings {
  return {
    endpoint: core.getInput("llm_endpoint", { required: true }).replace(/\/+$/, ""),
    model: core.getInput("llm_model", { required: true }),
    apiKey: core.getInput("llm_api_key", { required: true }),
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
 * - 部分兼容端点不支持 response_format（通常报 400），自动去掉该参数重试一次；
 * - 429/5xx/超时/网络错误按指数退避重试，最多 maxRetries 次。
 */
export async function callLlm(diff: string, config: ResolvedConfig, settings: LlmSettings): Promise<string> {
  const prompt = buildPrompt(diff, config.language, config.customInstructions);
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
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

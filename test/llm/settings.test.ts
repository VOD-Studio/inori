import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as core from "@actions/core";
import { readLlmSettings } from "../../src/llm";
import type { ResolvedConfig } from "../../src/config";

// ── readLlmSettings 的 API Key 查找顺序 ──
// 顺序：llm_api_key input > 推断 provider 的专属环境变量 > LLM_API_KEY
// > 默认 provider（deepseek）专属变量。不做跨 provider 乱序兜底：
// 历史 bug：provider=zhipu 时可能拿到 OPENAI_API_KEY 去打智谱端点，必 401。

const ENV_KEYS = [
  "INPUT_LLM_API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "ZHIPU_API_KEY",
] as const;

function minimalConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    provider: undefined,
    providerName: undefined,
    llmEndpoint: "https://api.deepseek.com/v1",
    llmModel: "deepseek-v4-flash",
    isCustomEndpoint: false,
    codingPlan: true,
    language: "zh",
    ignorePatterns: [],
    customInstructions: "",
    maxDiffChars: 1,
    maxBodyChars: 1,
    onUpdate: "replace",
    skipDraft: true,
    ignoreBots: true,
    ignoreAuthors: [],
    ...overrides,
  };
}

describe("readLlmSettings API Key 查找顺序", () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("llm_api_key input 最高优先", () => {
    process.env.INPUT_LLM_API_KEY = "from-input";
    process.env.ZHIPU_API_KEY = "from-zhipu-env";
    const s = readLlmSettings(minimalConfig({ provider: "zhipu" }));
    expect(s.apiKey).toBe("from-input");
    delete process.env.INPUT_LLM_API_KEY;
    delete process.env.ZHIPU_API_KEY;
  });

  it("provider=zhipu 时取 ZHIPU_API_KEY，绝不取 OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ZHIPU_API_KEY = "zhipu-key";
    const s = readLlmSettings(
      minimalConfig({ provider: "zhipu", providerName: "GLM" })
    );
    expect(s.apiKey).toBe("zhipu-key");
    delete process.env.OPENAI_API_KEY;
    delete process.env.ZHIPU_API_KEY;
  });

  it("provider 未识别时回退 LLM_API_KEY 通用变量", () => {
    process.env.LLM_API_KEY = "generic-key";
    const s = readLlmSettings(minimalConfig());
    expect(s.apiKey).toBe("generic-key");
    delete process.env.LLM_API_KEY;
  });

  it("无 provider 时默认链兜底 DEEPSEEK_API_KEY", () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    const s = readLlmSettings(minimalConfig());
    expect(s.apiKey).toBe("deepseek-key");
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("全部缺失时抛错并提示当前 provider 的专属变量名", () => {
    expect(() =>
      readLlmSettings(
        minimalConfig({ provider: "zhipu", providerName: "GLM" })
      )
    ).toThrow(/ZHIPU_API_KEY/);
  });

  it("endpoint 尾部斜杠被剥离", () => {
    process.env.LLM_API_KEY = "k";
    const s = readLlmSettings(
      minimalConfig({ llmEndpoint: "https://my-proxy.com/v1/", isCustomEndpoint: true })
    );
    expect(s.endpoint).toBe("https://my-proxy.com/v1");
    delete process.env.LLM_API_KEY;
  });
});

describe("Coding Plan key/端点防呆警告", () => {
  it("sk-sp- 套餐 key 配按量计费端点时警告", () => {
    process.env.INPUT_LLM_API_KEY = "sk-sp-xxxxx";
    const warn = vi.spyOn(core, "warning").mockImplementation(() => {});
    readLlmSettings(
      minimalConfig({
        provider: "dashscope",
        providerName: "Qwen",
        llmEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      })
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid_api_key"));
    warn.mockRestore();
    delete process.env.INPUT_LLM_API_KEY;
  });

  it("通用 key 配套餐端点时警告不抵扣套餐", () => {
    process.env.INPUT_LLM_API_KEY = "sk-normal-key";
    const warn = vi.spyOn(core, "warning").mockImplementation(() => {});
    readLlmSettings(
      minimalConfig({
        provider: "qwen-coding",
        providerName: "Qwen Coding Plan",
        llmEndpoint: "https://coding.dashscope.aliyuncs.com/v1",
      })
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("不会抵扣套餐额度"));
    warn.mockRestore();
    delete process.env.INPUT_LLM_API_KEY;
  });

  it("套餐 key + 套餐端点（正确组合）不警告", () => {
    process.env.INPUT_LLM_API_KEY = "sk-sp-xxxxx";
    const warn = vi.spyOn(core, "warning").mockImplementation(() => {});
    readLlmSettings(
      minimalConfig({
        provider: "qwen-coding",
        providerName: "Qwen Coding Plan",
        llmEndpoint: "https://coding.dashscope.aliyuncs.com/v1",
      })
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    delete process.env.INPUT_LLM_API_KEY;
  });

  it("MiniMax sk-cp- 订阅 key 配非 minimaxi 端点时警告", () => {
    process.env.INPUT_LLM_API_KEY = "sk-cp-xxxxx";
    const warn = vi.spyOn(core, "warning").mockImplementation(() => {});
    readLlmSettings(
      minimalConfig({
        provider: "deepseek",
        providerName: "DeepSeek",
        llmEndpoint: "https://api.deepseek.com/v1",
      })
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("minimaxi.com"));
    warn.mockRestore();
    delete process.env.INPUT_LLM_API_KEY;
  });

  it("MiniMax sk-cp- key 配 minimax 端点（按量/订阅共用）不警告", () => {
    process.env.INPUT_LLM_API_KEY = "sk-cp-xxxxx";
    const warn = vi.spyOn(core, "warning").mockImplementation(() => {});
    readLlmSettings(
      minimalConfig({
        provider: "minimax-token",
        providerName: "MiniMax Token Plan",
        llmEndpoint: "https://api.minimaxi.com/v1",
      })
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    delete process.env.INPUT_LLM_API_KEY;
  });
});


import { describe, it, expect } from "vitest";
import {
  findProvider,
  detectProviderByModel,
  resolveLlmEndpointAndModel,
  PROVIDER_PRESETS,
} from "../../src/llm/providers";

describe("PROVIDER_PRESETS 预设完整性与合法性", () => {
  it("包含全球与国内 22 个主流大模型提供商预设", () => {
    expect(PROVIDER_PRESETS.length).toBe(22);
    const ids = PROVIDER_PRESETS.map((p) => p.id);

    // 国内主流
    expect(ids).toContain("deepseek");
    expect(ids).toContain("zhipu");
    expect(ids).toContain("dashscope");
    expect(ids).toContain("qwen-coding");
    expect(ids).toContain("glm-coding");
    expect(ids).toContain("doubao-coding");
    expect(ids).toContain("minimax-token");
    expect(ids).toContain("siliconflow");
    expect(ids).toContain("moonshot");
    expect(ids).toContain("volcengine");
    expect(ids).toContain("minimax");


    expect(ids).toContain("google");
    expect(ids).toContain("xai");
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("groq");
    expect(ids).toContain("github-models");

    expect(ids).toContain("mistral");
    expect(ids).toContain("perplexity");
    expect(ids).toContain("ollama");
    expect(ids).toContain("local");
  });

  it("每个预设均包含有效的 defaultEndpoint 与 defaultModel", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.defaultEndpoint).toMatch(/^https?:\/\//);
      expect(preset.defaultModel).toBeTruthy();
    }
  });
});

describe("findProvider 别名与名称匹配", () => {
  it("标准 ID 精确匹配（忽略大小写与首尾空格）", () => {
    expect(findProvider("deepseek")?.id).toBe("deepseek");
    expect(findProvider("  OpenAI  ")?.id).toBe("openai");
    expect(findProvider("zhipu")?.id).toBe("zhipu");
    expect(findProvider("DASHSCOPE")?.id).toBe("dashscope");
  });

  it("支持各大主流平台常见别名", () => {
    expect(findProvider("glm")?.id).toBe("zhipu");
    expect(findProvider("bigmodel")?.id).toBe("zhipu");
    expect(findProvider("codegeex")?.id).toBe("zhipu");

    expect(findProvider("qwen")?.id).toBe("dashscope");
    expect(findProvider("aliyun")?.id).toBe("dashscope");
    expect(findProvider("tongyi")?.id).toBe("dashscope");

    expect(findProvider("kimi")?.id).toBe("moonshot");
    expect(findProvider("doubao")?.id).toBe("volcengine");
    expect(findProvider("huoshan")?.id).toBe("volcengine");

    expect(findProvider("silicon")?.id).toBe("siliconflow");


    expect(findProvider("claude")?.id).toBe("anthropic");
    expect(findProvider("github")?.id).toBe("github-models");
    expect(findProvider("codestral")?.id).toBe("mistral");
  });

  it("未知 provider 返回 undefined", () => {
    expect(findProvider("unknown-ai-provider")).toBeUndefined();
    expect(findProvider("")).toBeUndefined();
    expect(findProvider(undefined)).toBeUndefined();
  });
});

describe("detectProviderByModel 通过模型特征模式自动推断 Provider", () => {
  it("识别国内主流模型名称", () => {
    expect(detectProviderByModel("deepseek-chat")?.id).toBe("deepseek");
    expect(detectProviderByModel("deepseek-reasoner")?.id).toBe("deepseek");

    expect(detectProviderByModel("glm-4-flash")?.id).toBe("zhipu");
    expect(detectProviderByModel("codegeex-4")?.id).toBe("zhipu");

    expect(detectProviderByModel("qwen-plus")?.id).toBe("dashscope");
    expect(detectProviderByModel("qwen-coder-plus")?.id).toBe("dashscope");
    expect(detectProviderByModel("qwen3-max")?.id).toBe("dashscope");
    expect(detectProviderByModel("qwen3-coder-plus")?.id).toBe("dashscope");
    expect(detectProviderByModel("qwen2.5-coder-32b-instruct")?.id).toBe("dashscope");

    expect(detectProviderByModel("kimi-k2.6")?.id).toBe("moonshot");
    expect(detectProviderByModel("kimi-latest")?.id).toBe("moonshot");

    expect(detectProviderByModel("doubao-seed-2-0-lite-260428")?.id).toBe("volcengine");
    expect(detectProviderByModel("doubao-coder-pro")?.id).toBe("volcengine");

    expect(detectProviderByModel("deepseek-ai/DeepSeek-V3")?.id).toBe("siliconflow");
    expect(detectProviderByModel("Qwen/Qwen2.5-Coder-32B-Instruct")?.id).toBe("siliconflow");


  });

  it("识别国际主流模型名称", () => {
    expect(detectProviderByModel("gpt-4o")?.id).toBe("openai");
    expect(detectProviderByModel("gpt-4o-mini")?.id).toBe("openai");
    expect(detectProviderByModel("o1-mini")?.id).toBe("openai");
    expect(detectProviderByModel("o3-mini")?.id).toBe("openai");

    expect(detectProviderByModel("gemini-2.5-pro")?.id).toBe("google");
    expect(detectProviderByModel("gemini-3.7-flash")?.id).toBe("google");
    expect(detectProviderByModel("grok-4.6")?.id).toBe("xai");

    expect(detectProviderByModel("claude-3-5-sonnet-20241022")?.id).toBe("anthropic");
    expect(detectProviderByModel("claude-3-7-sonnet")?.id).toBe("anthropic");

    expect(detectProviderByModel("openrouter/deepseek/deepseek-chat")?.id).toBe("openrouter");
    expect(detectProviderByModel("llama-3.3-70b-versatile")?.id).toBe("groq");
    expect(detectProviderByModel("codestral-latest")?.id).toBe("mistral");
    expect(detectProviderByModel("sonar-pro")?.id).toBe("perplexity");
  });

  it("无法匹配的模型返回 undefined", () => {
    expect(detectProviderByModel("my-custom-fine-tuned-model")).toBeUndefined();
    expect(detectProviderByModel("")).toBeUndefined();
    expect(detectProviderByModel(undefined)).toBeUndefined();
  });
});

describe("resolveLlmEndpointAndModel 综合自动补全与自定义优先级", () => {
  it("场景 1: 用户仅指定 provider（如 zhipu），自动补全其 URL 与默认模型", () => {
    const res = resolveLlmEndpointAndModel({ provider: "zhipu" });
    expect(res.endpoint).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(res.model).toBe("glm-4.7-flash");
    expect(res.provider).toBe("zhipu");
    expect(res.isCustomEndpoint).toBe(false);
  });

  it("Coding Plan 预设：qwen-coding 套餐端点与白名单模型", () => {
    const res = resolveLlmEndpointAndModel({ provider: "qwen-coding" });
    expect(res.endpoint).toBe("https://coding.dashscope.aliyuncs.com/v1");
    expect(res.model).toBe("qwen3-coder-plus");
    expect(res.provider).toBe("qwen-coding");
  });

  it("Coding Plan 预设：glm-coding 套餐端点（独立于按量计费 /api/paas/v4）", () => {
    const res = resolveLlmEndpointAndModel({ provider: "glm-coding" });
    expect(res.endpoint).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    expect(res.model).toBe("glm-5.3");
    expect(res.provider).toBe("glm-coding");
  });

  it("Coding Plan 预设：doubao-coding 套餐端点（独立于按量计费 /api/v3）", () => {
    const res = resolveLlmEndpointAndModel({ provider: "doubao-coding" });
    expect(res.endpoint).toBe("https://ark.cn-beijing.volces.com/api/coding/v3");
    expect(res.model).toBe("ark-code-latest");
    expect(res.provider).toBe("doubao-coding");
  });

  it("Token Plan 预设：minimax-token 与按量共用端点、模型 M2.7", () => {
    const res = resolveLlmEndpointAndModel({ provider: "minimax-token" });
    expect(res.endpoint).toBe("https://api.minimaxi.com/v1");
    expect(res.model).toBe("MiniMax-M2.7");
    expect(res.provider).toBe("minimax-token");
  });

  it("Coding Plan 别名归一化", () => {
    expect(findProvider("dashscope-coding")?.id).toBe("qwen-coding");
    expect(findProvider("zhipu-coding")?.id).toBe("glm-coding");
    expect(findProvider("volcengine-coding")?.id).toBe("doubao-coding");
    expect(findProvider("minimax-coding")?.id).toBe("minimax-token");
  });

  it("Coding Plan 模型名不做推断（modelPatterns 为空，避免与按量体系抢匹配）", () => {
    expect(detectProviderByModel("qwen3-coder-plus")?.id).not.toBe("qwen-coding");
    expect(detectProviderByModel("glm-5.3")?.id).toBe("zhipu"); // 仍按按量体系匹配
  });

  it("场景 2: 用户指定 provider（如 qwen 别名），自动归一化并使用默认模型", () => {
    const res = resolveLlmEndpointAndModel({ provider: "qwen" });
    expect(res.endpoint).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(res.model).toBe("qwen-plus");
    expect(res.provider).toBe("dashscope");
  });

  it("场景 3: 用户未传 provider 与 endpoint，仅传 model（如 gpt-4o），自动推断 OpenAI", () => {
    const res = resolveLlmEndpointAndModel({ model: "gpt-4o" });
    expect(res.endpoint).toBe("https://api.openai.com/v1");
    expect(res.model).toBe("gpt-4o");
    expect(res.provider).toBe("openai");
    expect(res.isCustomEndpoint).toBe(false);
  });

  it("场景 4: 用户未传 provider 与 endpoint，仅传 model（如 glm-4-flash），自动推断智谱", () => {
    const res = resolveLlmEndpointAndModel({ model: "glm-4-flash" });
    expect(res.endpoint).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(res.model).toBe("glm-4-flash");
    expect(res.provider).toBe("zhipu");
  });

  it("场景 5: 完全自定义 endpoint 优先级最高（绝不被推断覆盖）", () => {
    const res = resolveLlmEndpointAndModel({
      endpoint: "https://my-internal-gateway.corp.com/v1/",
      model: "gpt-4o",
    });
    expect(res.endpoint).toBe("https://my-internal-gateway.corp.com/v1");
    expect(res.model).toBe("gpt-4o");
    expect(res.isCustomEndpoint).toBe(true);
  });

  it("场景 6: 完全空输入时回退到 DeepSeek 默认配置", () => {
    const res = resolveLlmEndpointAndModel({});
    expect(res.endpoint).toBe("https://api.deepseek.com/v1");
    expect(res.model).toBe("deepseek-v4-flash");
    expect(res.isCustomEndpoint).toBe(false);
  });
});

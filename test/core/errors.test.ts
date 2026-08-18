import { describe, it, expect } from "vitest";
import { isRetryableLlmError, LlmHttpError } from "../../src/core/errors";

describe("isRetryableLlmError", () => {
  it("429 与 5xx 可重试，400 不可", () => {
    expect(isRetryableLlmError(new LlmHttpError(429, "rate limit"))).toBe(true);
    expect(isRetryableLlmError(new LlmHttpError(503, "unavailable"))).toBe(true);
    expect(isRetryableLlmError(new LlmHttpError(400, "bad request"))).toBe(false);
  });

  it("网络层错误（TypeError）可重试", () => {
    expect(isRetryableLlmError(new TypeError("fetch failed"))).toBe(true);
  });

  it("超时中止可重试", () => {
    const timeout = new Error("signal timed out");
    timeout.name = "TimeoutError";
    expect(isRetryableLlmError(timeout)).toBe(true);
  });

  it("其他错误不可重试", () => {
    expect(isRetryableLlmError(new Error("LLM 响应结构异常"))).toBe(false);
    expect(isRetryableLlmError(null)).toBe(false);
    expect(isRetryableLlmError("error")).toBe(false);
  });
});

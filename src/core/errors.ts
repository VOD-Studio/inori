// ── 错误分类与通用错误工具 ──

/** LLM HTTP 错误，携带状态码用于重试决策 */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(`LLM HTTP ${status}: ${detail}`);
    this.name = "LlmHttpError";
  }
}

/** 可重试的错误：429/5xx、网络层失败（TypeError）、超时/中止 */
export function isRetryableLlmError(e: unknown): boolean {
  if (e instanceof LlmHttpError) return e.status === 429 || e.status >= 500;
  if (e instanceof TypeError) return true;
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

/** 安全提取任意抛出值的 message（替代 `(e as Error).message` 散写） */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

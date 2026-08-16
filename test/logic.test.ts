import { describe, it, expect } from "vitest";
import {
  isIgnored,
  addedLines,
  parseReviews,
  buildPrompt,
  buildReviewBody,
  REVIEW_MARKER,
  isRetryableLlmError,
  LlmHttpError,
} from "../src/logic";

// isIgnored 用 action 的真实默认 patterns（与 action.yml 一致）
const DEFAULT_PATTERNS = [
  "pnpm-lock.yaml",
  "go.sum",
  "package-lock.json",
  "yarn.lock",
  "CHANGELOG.md",
];

describe("isIgnored", () => {
  it("根目录精确匹配 lockfile", () => {
    expect(isIgnored("pnpm-lock.yaml", DEFAULT_PATTERNS)).toBe(true);
    expect(isIgnored("go.sum", DEFAULT_PATTERNS)).toBe(true);
    expect(isIgnored("package-lock.json", DEFAULT_PATTERNS)).toBe(true);
  });

  it("子目录同样匹配（**/<pattern>）", () => {
    expect(isIgnored("packages/x/pnpm-lock.yaml", DEFAULT_PATTERNS)).toBe(true);
    expect(isIgnored("apps/web/yarn.lock", DEFAULT_PATTERNS)).toBe(true);
  });

  it("普通源码不命中", () => {
    expect(isIgnored("src/index.ts", DEFAULT_PATTERNS)).toBe(false);
    expect(isIgnored("web/app.tsx", DEFAULT_PATTERNS)).toBe(false);
  });

  it("自定义 glob 模式生效", () => {
    expect(isIgnored("README.md", ["*.md"])).toBe(true);
    expect(isIgnored("docs/guide.md", ["*.md"])).toBe(true);
    expect(isIgnored("src/index.ts", ["*.md"])).toBe(false);
  });

  it("空 patterns 不忽略任何文件", () => {
    expect(isIgnored("pnpm-lock.yaml", [])).toBe(false);
  });
});

describe("addedLines", () => {
  it("提取连续新增行号", () => {
    const patch = "@@ -1,3 +1,5 @@\n unchanged\n-old line\n+new line 1\n+new line 2\n ctx";
    expect(addedLines(patch)).toEqual(new Set([2, 3]));
  });

  it("跳过 +++ 文件头不误计", () => {
    const patch = "@@ -1,1 +10,2 @@\n+++ b/foo.py\n+real add";
    expect(addedLines(patch)).toEqual(new Set([10]));
  });

  it("多 hunk 合并行号", () => {
    const patch =
      "@@ -1,1 +5,2 @@\n+first\n ctx\n@@ -10,1 +20,2 @@\n+second\n ctx";
    expect(addedLines(patch)).toEqual(new Set([5, 20]));
  });

  it("删除行不占用行号，上下文推进行号", () => {
    // hunk +6 → ctx 推进到 7 → -行不推进 → +added 落在 line 7
    const patch = "@@ -1,3 +6,3 @@\n ctx\n-removed\n+added\n ctx2";
    expect(addedLines(patch)).toEqual(new Set([7]));
  });

  it("空 patch 返回空集合", () => {
    expect(addedLines("")).toEqual(new Set());
  });
});

describe("parseReviews", () => {
  const fileLines = new Map([["a.ts", new Set([5, 10])]]);

  it("reviews=null 不崩溃", () => {
    const r = parseReviews('{"summary":"s","reviews":null}', fileLines);
    expect(r.summary).toBe("s");
    expect(r.inlines).toHaveLength(0);
  });

  it("非对象元素被跳过", () => {
    const r = parseReviews('{"summary":"s","reviews":[123,"x",null]}', fileLines);
    expect(r.inlines).toHaveLength(0);
    expect(r.bodyItems).toHaveLength(0);
  });

  it("行号命中 fileLines 成为 inline", () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":5,"severity":"严重","comment":"bug"}]}',
      fileLines
    );
    expect(r.inlines).toHaveLength(1);
    expect(r.inlines[0].line).toBe(5);
    expect(r.inlines[0].body).toBe("**[严重]** bug");
  });

  it("无 severity 时 body 不带标记", () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":10,"comment":"note"}]}',
      fileLines
    );
    expect(r.inlines[0].body).toBe("note");
  });

  it("行号无效降级到 body", () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":999,"comment":"bug"}]}',
      fileLines
    );
    expect(r.inlines).toHaveLength(0);
    expect(r.bodyItems).toHaveLength(1);
    expect(r.bodyItems[0]).toBe("- bug（a.ts）");
  });

  it("comment 为空的条目被丢弃", () => {
    const r = parseReviews(
      '{"summary":"ok","reviews":[{"path":"a.ts","line":5,"comment":""}]}',
      fileLines
    );
    expect(r.inlines).toHaveLength(0);
    expect(r.bodyItems).toHaveLength(0);
  });

  it("非 JSON 返回原文作为 summary", () => {
    const r = parseReviews("not json", fileLines);
    expect(r.summary).toBe("not json");
    expect(r.inlines).toHaveLength(0);
  });
});

describe("parseReviews 围栏容错", () => {
  const fileLines = new Map([["a.ts", new Set([5])]]);

  it("剥离 ```json 围栏后正常解析", () => {
    const content =
      '```json\n{"summary":"s","reviews":[{"path":"a.ts","line":5,"comment":"bug"}]}\n```';
    const r = parseReviews(content, fileLines);
    expect(r.summary).toBe("s");
    expect(r.inlines).toHaveLength(1);
  });

  it("无语言标记的围栏也能解析", () => {
    const r = parseReviews('```\n{"summary":"s"}\n```', fileLines);
    expect(r.summary).toBe("s");
  });

  it("围栏外有说明文字时提取 JSON 部分", () => {
    const r = parseReviews('评审结果如下：\n```json\n{"summary":"s"}\n```\n以上。', fileLines);
    expect(r.summary).toBe("s");
  });

  it("无围栏但前后有杂质时按花括号截取", () => {
    const r = parseReviews('result: {"summary":"s"} (end)', fileLines);
    expect(r.summary).toBe("s");
  });

  it("围栏内 JSON 损坏时回退原文 summary", () => {
    const content = "```json\n{broken\n```";
    const r = parseReviews(content, fileLines);
    expect(r.summary).toBe(content);
    expect(r.inlines).toHaveLength(0);
  });
});

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

describe("buildPrompt", () => {
  it("中文 prompt 含中文输出提示与 diff", () => {
    const p = buildPrompt("SOME_DIFF", "zh");
    expect(p).toContain("用中文输出");
    expect(p).toContain("严重|中等|轻微");
    expect(p).toContain("SOME_DIFF");
  });

  it("英文 prompt 含英文输出提示", () => {
    const p = buildPrompt("D", "en");
    expect(p).toContain("Output in English");
    expect(p).toContain("critical|major|minor");
  });
});

describe("buildPrompt 自定义规则", () => {
  it("customInstructions 注入 prompt", () => {
    const p = buildPrompt("D", "zh", "禁止使用 moment；错误必须向上抛出");
    expect(p).toContain("仓库自定义审查要求");
    expect(p).toContain("禁止使用 moment；错误必须向上抛出");
    expect(p).toContain("D");
  });

  it("不传时不注入自定义段落", () => {
    const p = buildPrompt("D", "zh");
    expect(p).not.toContain("仓库自定义审查要求");
  });

  it("空白内容视为未传入", () => {
    const p = buildPrompt("D", "zh", "   ");
    expect(p).not.toContain("仓库自定义审查要求");
  });
});

describe("buildReviewBody", () => {
  it("标题含模型名，结尾嵌隐藏标记", () => {
    const body = buildReviewBody({ summary: "s", bodyItems: [], model: "deepseek-chat" }, "zh", 60000);
    expect(body).toContain("### AI Code Review · deepseek-chat");
    expect(body).toContain("## 评审结论\ns");
    expect(body.endsWith(REVIEW_MARKER)).toBe(true);
  });

  it("bodyItems 进入其他问题清单", () => {
    const body = buildReviewBody(
      { summary: "s", bodyItems: ["- 存在问题（a.ts）"], model: "m" },
      "zh",
      60000
    );
    expect(body).toContain("## 其他问题\n- 存在问题（a.ts）");
  });

  it("空 summary 显示无问题文案", () => {
    const body = buildReviewBody({ summary: "", bodyItems: [], model: "m" }, "zh", 60000);
    expect(body).toContain("未发现明显问题");
  });

  it("截断后仍保留截断提示与标记", () => {
    const body = buildReviewBody(
      { summary: "x".repeat(100), bodyItems: [], model: "m" },
      "zh",
      50
    );
    expect(body).toContain("（内容过长已截断）");
    expect(body.endsWith(REVIEW_MARKER)).toBe(true);
  });

  it("en 文案生效", () => {
    const body = buildReviewBody({ summary: "", bodyItems: [], model: "m" }, "en", 60000);
    expect(body).toContain("No significant issues found");
    expect(body.endsWith(REVIEW_MARKER)).toBe(true);
  });
});

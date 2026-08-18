import { describe, it, expect } from "vitest";
import {
  isIgnored,
  addedLines,
  parseReviews,
  buildPrompt,
  buildReviewBody,
  formatDiffAndTruncate,
  parseConfigFile,
  resolveConfig,
  shouldSkipReview,
  DEFAULT_IGNORE_PATTERNS,
  REVIEW_MARKER,
  isRetryableLlmError,
  LlmHttpError,
} from "../src/logic";

describe("DEFAULT_IGNORE_PATTERNS 与 isIgnored", () => {
  it("匹配所有主流锁文件", () => {
    const locks = [
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "go.sum",
      "Cargo.lock",
      "poetry.lock",
      "composer.lock",
      "sub/dir/Cargo.lock",
    ];
    for (const lock of locks) {
      expect(isIgnored(lock, DEFAULT_IGNORE_PATTERNS)).toBe(true);
    }
  });

  it("匹配压缩产物与 sourcemap", () => {
    expect(isIgnored("dist/bundle.min.js", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(isIgnored("styles/theme.min.css", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(isIgnored("dist/app.js.map", DEFAULT_IGNORE_PATTERNS)).toBe(true);
  });

  it("匹配 SVG 矢量图资源", () => {
    expect(isIgnored("public/icons/logo.svg", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(isIgnored("icon.svg", DEFAULT_IGNORE_PATTERNS)).toBe(true);
  });

  it("匹配发版清单与 Changelog", () => {
    expect(isIgnored("CHANGELOG.md", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(isIgnored(".release-please-manifest.json", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(isIgnored("pkg/.release-please-manifest.json", DEFAULT_IGNORE_PATTERNS)).toBe(true);
  });

  it("普通源码不被忽略", () => {
    expect(isIgnored("src/index.ts", DEFAULT_IGNORE_PATTERNS)).toBe(false);
    expect(isIgnored("web/app.tsx", DEFAULT_IGNORE_PATTERNS)).toBe(false);
    expect(isIgnored("cmd/main.go", DEFAULT_IGNORE_PATTERNS)).toBe(false);
  });
});
describe("isIgnored 自定义模式", () => {
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

describe("buildPrompt 收口纪律 (Issue 1)", () => {
  it("中文 prompt 包含四条评审纪律", () => {
    const p = buildPrompt("DIFF_CONTENT", "zh");
    expect(p).toContain("评审纪律");
    expect(p).toContain("够格标准");
    expect(p).toContain("明确排除");
    expect(p).toContain("引文纪律");
    expect(p).toContain("严重度校准");
  });

  it("英文 prompt 包含 Review Discipline", () => {
    const p = buildPrompt("DIFF_CONTENT", "en");
    expect(p).toContain("Review Discipline");
    expect(p).toContain("Bar for reporting");
    expect(p).toContain("Explicit exclusions");
    expect(p).toContain("Quote accuracy");
    expect(p).toContain("Severity calibration");
  });
});

describe("formatDiffAndTruncate (Issue 4)", () => {
  it("空文件或无有效 patch 返回空", () => {
    const res = formatDiffAndTruncate([], 1000);
    expect(res.diff).toBe("");
    expect(res.truncated).toBe(false);
    expect(res.omittedCount).toBe(0);

    const res2 = formatDiffAndTruncate([{ filename: "a.ts", patch: "" }], 1000);
    expect(res2.diff).toBe("");
    expect(res2.truncated).toBe(false);
  });

  it("文件未超限时完整返回", () => {
    const files = [
      { filename: "a.ts", patch: "+line 1" },
      { filename: "b.ts", patch: "+line 2" },
    ];
    const res = formatDiffAndTruncate(files, 1000, "zh");
    expect(res.truncated).toBe(false);
    expect(res.omittedCount).toBe(0);
    expect(res.includedFiles).toEqual(["a.ts", "b.ts"]);
    expect(res.diff).toContain("--- a.ts\n+line 1");
    expect(res.diff).toContain("--- b.ts\n+line 2");
  });

  it("超过限制时按文件块安全截断并追加提示文案", () => {
    const files = [
      { filename: "a.ts", patch: "+first file patch content" },
      { filename: "b.ts", patch: "+second file patch content" },
      { filename: "c.ts", patch: "+third file patch content" },
    ];
    // 只够容纳第一个文件，容纳不下第二个文件
    const chunk1 = "--- a.ts\n+first file patch content";
    const res = formatDiffAndTruncate(files, chunk1.length + 5, "zh");
    expect(res.truncated).toBe(true);
    expect(res.omittedCount).toBe(2);
    expect(res.includedFiles).toEqual(["a.ts"]);
    expect(res.diff).toContain("--- a.ts");
    expect(res.diff).not.toContain("--- b.ts");
    expect(res.diff).toContain("... (由于长度超限，已略去后续 2 个文件的 diff)");
  });

  it("英文提示截断文案", () => {
    const files = [
      { filename: "a.ts", patch: "+patch a" },
      { filename: "b.ts", patch: "+patch b" },
    ];
    const res = formatDiffAndTruncate(files, 15, "en");
    expect(res.truncated).toBe(true);
    expect(res.diff).toContain("due to length limit, diffs of 1 subsequent files omitted");
  });
});

describe("parseConfigFile 与 resolveConfig (Issue 5 & Issue 2)", () => {
  it("解析有效 YAML 配置", () => {
    const yaml = `
language: en
max_diff_chars: 50000
on_update: resolve
skip_draft: false
ignore_bots: false
ignore_patterns:
  - "*.generated.ts"
  - "fixtures/**"
ignore_authors:
  - "bot-user"
custom_instructions: |
  No inline styles.
`;
    const config = parseConfigFile(yaml);
    expect(config.language).toBe("en");
    expect(config.max_diff_chars).toBe(50000);
    expect(config.on_update).toBe("resolve");
    expect(config.skip_draft).toBe(false);
    expect(config.ignore_bots).toBe(false);
    expect(config.ignore_patterns).toEqual(["*.generated.ts", "fixtures/**"]);
    expect(config.ignore_authors).toEqual(["bot-user"]);
    expect(config.custom_instructions).toContain("No inline styles.");
  });

  it("非法 YAML 容错返回空对象", () => {
    expect(parseConfigFile(":::invalid")).toEqual({});
    expect(parseConfigFile("")).toEqual({});
  });

  it("优先级：Action Inputs > 配置文件 > 内置默认值", () => {
    const fileConfig = {
      language: "en" as const,
      max_diff_chars: 50000,
      custom_instructions: "From file",
      on_update: "resolve" as const,
    };

    const resolved = resolveConfig(
      {
        language: "zh", // 覆盖为 zh
        custom_instructions: "From input", // 覆盖
      },
      fileConfig
    );

    expect(resolved.language).toBe("zh");
    expect(resolved.customInstructions).toBe("From input");
    expect(resolved.maxDiffChars).toBe(50000); // 继承自 file
    expect(resolved.maxBodyChars).toBe(60000); // 继承默认值
    expect(resolved.onUpdate).toBe("resolve"); // 继承自 file
  });

  it("ignore_patterns 合并默认与自定义", () => {
    const resolved = resolveConfig(
      { ignore_patterns: "*.test.ts, temp/*" },
      { ignore_patterns: ["*.json"] }
    );
    expect(resolved.ignorePatterns).toContain("pnpm-lock.yaml");
    expect(resolved.ignorePatterns).toContain("*.test.ts");
    expect(resolved.ignorePatterns).toContain("temp/*");
  });

  it("keep_previous_comments 向下兼容映射为 onUpdate: keep", () => {
    const resolved = resolveConfig({ keep_previous_comments: "true" });
    expect(resolved.onUpdate).toBe("keep");

    const resolved2 = resolveConfig({}, { keep_previous_comments: true });
    expect(resolved2.onUpdate).toBe("keep");
  });
});

describe("shouldSkipReview 智能早退 (Issue 3)", () => {
  it("草稿 PR 默认早退", () => {
    const res = shouldSkipReview({ isDraft: true, skipDraft: true, lang: "zh" });
    expect(res.skip).toBe(true);
    expect(res.reason).toBe("跳过草稿 PR 评审");
  });

  it("skipDraft 为 false 时草稿 PR 不早退", () => {
    const res = shouldSkipReview({ isDraft: true, skipDraft: false });
    expect(res.skip).toBe(false);
  });

  it("识别各类 Bot 账号并早退", () => {
    expect(
      shouldSkipReview({
        author: { login: "dependabot[bot]" },
        ignoreBots: true,
        lang: "zh",
      }).skip
    ).toBe(true);

    expect(
      shouldSkipReview({
        author: { login: "renovate-bot" },
        ignoreBots: true,
        lang: "zh",
      }).skip
    ).toBe(true);

    expect(
      shouldSkipReview({
        author: { login: "custom-user", type: "Bot" },
        ignoreBots: true,
        lang: "en",
      }).reason
    ).toBe("Skipping bot PR review (custom-user)");
  });

  it("命中 ignoreAuthors 时早退", () => {
    const res = shouldSkipReview({
      author: { login: "deploy-service" },
      ignoreAuthors: ["deploy-service", "ci-runner"],
      lang: "zh",
    });
    expect(res.skip).toBe(true);
    expect(res.reason).toContain("跳过指定作者 PR 评审");
  });

  it("正常开发者 PR 不早退", () => {
    const res = shouldSkipReview({
      isDraft: false,
      skipDraft: true,
      author: { login: "octocat", type: "User" },
      ignoreBots: true,
      ignoreAuthors: ["other-user"],
    });
    expect(res.skip).toBe(false);
  });
});

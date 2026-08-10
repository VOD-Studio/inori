import { describe, it, expect } from "vitest";
import {
  isIgnored,
  addedLines,
  parseReviews,
  buildPrompt,
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

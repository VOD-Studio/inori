import { describe, it, expect } from "vitest";
import { parseReviews, buildReviewBody, REVIEW_MARKER, extractJson } from "../../src/core/review";

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

describe("extractJson", () => {
  it("围栏与杂质剥离后返回纯 JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('x {"a":1} y')).toBe('{"a":1}');
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

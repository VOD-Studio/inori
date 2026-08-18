import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/core/prompt";

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

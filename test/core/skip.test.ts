import { describe, it, expect } from "vitest";
import { shouldSkipReview } from "../../src/core/skip";

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

import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHub } from "@actions/github/lib/utils";
import {
  I18N,
  isIgnored,
  addedLines,
  parseReviews,
  buildPrompt,
  LlmHttpError,
  isRetryableLlmError,
  type PrFile,
  type InlineComment,
} from "./logic";

/** getOctokit 返回的实例类型，带 rest API 与分页能力 */
type OctokitInstance = InstanceType<typeof GitHub>;

// ── 配置（从 action inputs 读取）──

const LLM_ENDPOINT = core.getInput("llm_endpoint", { required: true }).replace(/\/+$/, "");
const LLM_MODEL = core.getInput("llm_model", { required: true });
const LLM_API_KEY = core.getInput("llm_api_key", { required: true });
const GITHUB_TOKEN = core.getInput("github_token", { required: true });
const LANGUAGE = (core.getInput("language") || "zh").toLowerCase() as "zh" | "en";
const IGNORE_PATTERNS = core.getInput("ignore_patterns")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const MAX_DIFF_CHARS = parseInt(core.getInput("max_diff_chars") || "40000", 10);
const MAX_BODY_CHARS = parseInt(core.getInput("max_body_chars") || "60000", 10);

// 单次 LLM 调用 5 分钟上限，端点挂起时及时中止而不是卡满整个 job
const LLM_TIMEOUT_MS = 300_000;
// 429/5xx/超时/网络错误的退避重试次数
const MAX_LLM_RETRIES = 3;

const T = I18N[LANGUAGE] ?? I18N.zh;

// ── IO：拉取 diff ──

/**
 * 分页拉取 PR 全部文件（GitHub API 单页上限 100），拼接 diff，
 * 返回 diff 文本与各文件新增行号集合（用于 inline 锚点校验）。
 */
async function getPrDiff(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number
): Promise<{ diff: string; fileLines: Map<string, Set<number>> }> {
  const fileLines = new Map<string, Set<number>>();
  const chunks: string[] = [];
  let page = 1;
  let files: PrFile[] = [];

  do {
    const resp = await octokit.rest.pulls.listFiles({
      ...repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    files = resp.data as PrFile[];
    for (const f of files) {
      if (isIgnored(f.filename, IGNORE_PATTERNS)) {
        core.info(`忽略 ${f.filename}`);
        continue;
      }
      const patch = f.patch ?? "";
      if (!patch) continue;
      fileLines.set(f.filename, addedLines(patch));
      chunks.push(`--- ${f.filename}\n${patch}`);
    }
    page += 1;
  } while (files.length === 100);

  let diff = chunks.join("\n");
  if (diff.length > MAX_DIFF_CHARS) {
    core.info(`diff 过大（${diff.length} 字符），截断到 ${MAX_DIFF_CHARS}`);
    diff = diff.slice(0, MAX_DIFF_CHARS);
    // 截断后模型可能针对未见代码给行号，禁用 inline 锚定全部走 body
    fileLines.clear();
  }
  return { diff, fileLines };
}

// ── IO：调用 LLM ──

/** 单次调用 OpenAI 兼容的 /chat/completions 接口，非 2xx 抛 LlmHttpError */
async function chatCompletions(body: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${LLM_ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LLM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    throw new LlmHttpError(resp.status, detail);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`LLM 响应结构异常: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return content.trim();
}

/**
 * 调用 LLM：
 * - 部分兼容端点不支持 response_format（通常报 400），自动去掉该参数重试一次；
 * - 429/5xx/超时/网络错误按指数退避重试，最多 MAX_LLM_RETRIES 次。
 */
async function callLlm(diff: string): Promise<string> {
  const prompt = buildPrompt(diff, LANGUAGE);
  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  };

  let droppedResponseFormat = false;
  let attempt = 0;
  for (;;) {
    try {
      return await chatCompletions(body);
    } catch (e) {
      if (e instanceof LlmHttpError && e.status === 400 && !droppedResponseFormat) {
        droppedResponseFormat = true;
        delete body.response_format;
        core.warning("端点可能不支持 response_format，已去掉该参数重试");
        continue;
      }
      attempt += 1;
      if (attempt > MAX_LLM_RETRIES || !isRetryableLlmError(e)) throw e;
      const delayMs = 1000 * 2 ** attempt;
      core.warning(
        `LLM 调用失败：${(e as Error).message}，${delayMs / 1000}s 后重试（${attempt}/${MAX_LLM_RETRIES}）`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ── IO：发布评审 ──

/** 发布评审：先逐条发 inline 评论（失败跳过），再发汇总 review */
async function postReview(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number,
  headSha: string,
  body: string,
  inlines: InlineComment[]
): Promise<void> {
  // inline 评论先建；锚点无效或 API 失败时跳过该条，body 汇总仍覆盖整体结论
  for (const ic of inlines) {
    try {
      await octokit.rest.pulls.createReviewComment({
        ...repo,
        pull_number: prNumber,
        body: ic.body,
        path: ic.path,
        line: ic.line,
        commit_id: headSha,
      });
      core.info(`inline 评论: ${ic.path}:${ic.line}`);
    } catch (e) {
      core.warning(`inline 评论失败，跳过该条：${(e as Error).message}`);
    }
  }
  await octokit.rest.pulls.createReview({
    ...repo,
    pull_number: prNumber,
    body,
    event: "COMMENT",
    commit_id: headSha,
  });
}

// ── 入口 ──

async function main(): Promise<void> {
  const ctx = github.context;
  if (!ctx.payload.pull_request) {
    core.setFailed("非 pull_request 事件，跳过");
    return;
  }
  const pr = ctx.payload.pull_request as {
    number: number;
    head: { sha: string };
  };
  const octokit = github.getOctokit(GITHUB_TOKEN);
  const repo = { owner: ctx.repo.owner, repo: ctx.repo.repo };

  const { diff, fileLines } = await getPrDiff(octokit, repo, pr.number);
  if (!diff) {
    core.info("没有可评审的 diff");
    return;
  }
  core.info(`评审 ${ctx.repo.owner}/${ctx.repo.repo} PR #${pr.number}，diff ${diff.length} 字符，模型 ${LLM_MODEL}`);

  const content = await callLlm(diff);
  const { summary, inlines, bodyItems } = parseReviews(content, fileLines);
  if (!summary && !inlines.length && !bodyItems.length) {
    core.info("模型未输出评审意见");
    return;
  }

  let body = `${T.reviewTitle}\n\n${T.summaryHeading}\n${summary || T.noIssues}`;
  if (bodyItems.length) {
    body += `\n\n${T.othersHeading}\n` + bodyItems.join("\n");
  }
  if (body.length > MAX_BODY_CHARS) {
    core.info(`评审内容过长（${body.length} 字符），截断`);
    body = body.slice(0, MAX_BODY_CHARS) + `\n\n${T.truncated}`;
  }

  await postReview(octokit, repo, pr.number, pr.head.sha, body, inlines);
  core.info("评审已发布");
}

main().catch((e) => {
  core.setFailed(`评审失败：${(e as Error).message}`);
});

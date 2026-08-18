import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHub } from "@actions/github/lib/utils";
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
  REVIEW_MARKER,
  LlmHttpError,
  isRetryableLlmError,
  type PrFile,
  type InlineComment,
  type InoriConfig,
  type ResolvedConfig,
} from "./logic";

/** getOctokit 返回的实例类型，带 rest API 与分页能力 */
type OctokitInstance = InstanceType<typeof GitHub>;

// ── 配置读取 ──

function loadRepoConfigFile(workspaceDir = process.cwd()): InoriConfig {
  const candidateFiles = [
    path.join(workspaceDir, ".github", "inori.yml"),
    path.join(workspaceDir, ".github", "inori.yaml"),
  ];
  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        core.info(`读取仓库配置文件：${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        return parseConfigFile(content);
      } catch (e) {
        core.warning(`解析配置文件 ${filePath} 失败：${(e as Error).message}`);
      }
    }
  }
  return {};
}

const LLM_ENDPOINT = core.getInput("llm_endpoint", { required: true }).replace(/\/+$/, "");
const LLM_MODEL = core.getInput("llm_model", { required: true });
const LLM_API_KEY = core.getInput("llm_api_key", { required: true });
const GITHUB_TOKEN = core.getInput("github_token", { required: true });

// 单次 LLM 调用 5 分钟上限，端点挂起时及时中止而不是卡满整个 job
const LLM_TIMEOUT_MS = 300_000;
// 429/5xx/超时/网络错误的退避重试次数
const MAX_LLM_RETRIES = 3;
// ── IO：拉取 diff ──

/**
 * 分页拉取 PR 全部文件（GitHub API 单页上限 100），经过过滤与安全文件块截断，
 * 返回 diff 文本与各文件新增行号集合（用于 inline 锚点校验）。
 */
async function getPrDiff(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number,
  config: ResolvedConfig
): Promise<{ diff: string; fileLines: Map<string, Set<number>> }> {
  const fileLines = new Map<string, Set<number>>();
  const validFiles: { filename: string; patch: string }[] = [];
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
      if (isIgnored(f.filename, config.ignorePatterns)) {
        core.info(`忽略 ${f.filename}`);
        continue;
      }
      const patch = f.patch ?? "";
      if (!patch) continue;
      validFiles.push({ filename: f.filename, patch });
    }
    page += 1;
  } while (files.length === 100);

  const truncatedResult = formatDiffAndTruncate(
    validFiles,
    config.maxDiffChars,
    config.language
  );

  if (truncatedResult.truncated) {
    core.info(
      `diff 过大，已按文件块安全截断到 ${config.maxDiffChars} 字符以内（略去后续 ${truncatedResult.omittedCount} 个文件）`
    );
  }

  // 仅对被保留在 diff 中的文件建立行号映射
  const includedSet = new Set(truncatedResult.includedFiles);
  for (const f of validFiles) {
    if (includedSet.has(f.filename)) {
      fileLines.set(f.filename, addedLines(f.patch));
    }
  }

  return { diff: truncatedResult.diff, fileLines };
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
async function callLlm(diff: string, config: ResolvedConfig): Promise<string> {
  const prompt = buildPrompt(diff, config.language, config.customInstructions);
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

/**
 * 删除上一轮 inori 的 inline 评论（body 内嵌标记识别）。
 * 有人回复过的线程跳过，不破坏人工讨论。
 */
async function deleteOldInlineComments(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number
): Promise<void> {
  const all: { id: number; body?: string | null; in_reply_to_id?: number }[] = [];
  let page = 1;
  let comments: typeof all = [];
  do {
    const resp = await octokit.rest.pulls.listReviewComments({
      ...repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    comments = resp.data as typeof all;
    all.push(...comments);
    page += 1;
  } while (comments.length === 100);

  const replied = new Set(
    all.filter((c) => c.in_reply_to_id).map((c) => c.in_reply_to_id as number)
  );
  for (const c of all) {
    if (!c.body?.includes(REVIEW_MARKER) || c.in_reply_to_id || replied.has(c.id)) continue;
    try {
      await octokit.rest.pulls.deleteReviewComment({ ...repo, comment_id: c.id });
    } catch (e) {
      core.warning(`删除旧 inline 评论 #${c.id} 失败：${(e as Error).message}`);
    }
  }
}

/**
 * 将上一轮 inori 创建且未被人工回复的 review threads 标记为 Resolved。
 */
async function resolveOldInlineThreads(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number
): Promise<void> {
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = (await octokit.graphql(
      `
      query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                isResolved
                comments(first: 100) {
                  nodes {
                    id
                    body
                  }
                }
              }
            }
          }
        }
      }
    `,
      {
        owner: repo.owner,
        repo: repo.repo,
        prNumber,
        cursor,
      }
    )) as {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            pageInfo?: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            nodes?: {
              id: string;
              isResolved: boolean;
              comments?: {
                nodes?: {
                  id: string;
                  body: string;
                }[];
              };
            }[];
          };
        };
      };
    };

    const threads = data.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    for (const thread of threads) {
      if (thread.isResolved) continue;
      const comments = thread.comments?.nodes ?? [];
      if (comments.length === 0) continue;
      const firstComment = comments[0];
      if (firstComment.body.includes(REVIEW_MARKER) && comments.length === 1) {
        try {
          await octokit.graphql(
            `
            mutation($threadId: ID!) {
              resolveReviewThread(input: { threadId: $threadId }) {
                thread {
                  id
                  isResolved
                }
              }
            }
          `,
            { threadId: thread.id }
          );
          core.info(`已将历史评审线程 ${thread.id} 标记为已解决 (Resolved)`);
        } catch (e) {
          core.warning(`标记评审线程 ${thread.id} 已解决失败：${(e as Error).message}`);
        }
      }
    }

    const pageInfo = data.repository?.pullRequest?.reviewThreads?.pageInfo;
    hasNextPage = pageInfo?.hasNextPage ?? false;
    cursor = pageInfo?.endCursor ?? null;
  }
}

/** 找到最近一轮 inori 评审的 id（body 内嵌标记识别），无则返回 null */
async function findOldReviewId(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number
): Promise<number | null> {
  let target: number | null = null;
  let page = 1;
  let reviews: { id: number; body?: string | null }[] = [];
  do {
    const resp = await octokit.rest.pulls.listReviews({
      ...repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    reviews = resp.data as { id: number; body?: string | null }[];
    // 列表按提交时间升序，持续覆盖取最后一个命中的
    for (const rv of reviews) {
      if (rv.body?.includes(REVIEW_MARKER)) target = rv.id;
    }
    page += 1;
  } while (reviews.length === 100);
  return target;
}

/**
 * 发布评审（更新复用模式）：GitHub REST 无法删除已提交的 review，
 * 因此汇总 body 复用同一轮评审（updateReview 原地更新），inline 评论
 * 先删旧的再逐条发新的（每条内嵌标记供下轮识别清理），多次 push 不堆叠。
 */
async function postReview(
  octokit: OctokitInstance,
  repo: { owner: string; repo: string },
  prNumber: number,
  headSha: string,
  body: string,
  inlines: InlineComment[],
  onUpdate: "replace" | "resolve" | "keep"
): Promise<void> {
  if (onUpdate === "replace") {
    try {
      await deleteOldInlineComments(octokit, repo, prNumber);
    } catch (e) {
      core.warning(`清理旧 inline 评论失败，继续发布：${(e as Error).message}`);
    }
  } else if (onUpdate === "resolve") {
    try {
      await resolveOldInlineThreads(octokit, repo, prNumber);
    } catch (e) {
      core.warning(`解决旧 inline 评审线程失败，继续发布：${(e as Error).message}`);
    }
  }
  let posted = false;
  try {
    const oldId = await findOldReviewId(octokit, repo, prNumber);
    if (oldId !== null) {
      await octokit.rest.pulls.updateReview({
        ...repo,
        pull_number: prNumber,
        review_id: oldId,
        body,
      });
      posted = true;
    }
  } catch (e) {
    core.warning(`更新旧评审失败，改为新建：${(e as Error).message}`);
  }
  if (!posted) {
    await octokit.rest.pulls.createReview({
      ...repo,
      pull_number: prNumber,
      body,
      event: "COMMENT",
      commit_id: headSha,
    });
  }

  // inline 逐条发布，单条失败只跳过该条；汇总 body 已覆盖整体结论
  for (const ic of inlines) {
    try {
      await octokit.rest.pulls.createReviewComment({
        ...repo,
        pull_number: prNumber,
        body: `${ic.body}\n\n${REVIEW_MARKER}`,
        path: ic.path,
        line: ic.line,
        commit_id: headSha,
      });
      core.info(`inline 评论: ${ic.path}:${ic.line}`);
    } catch (e) {
      core.warning(`inline 评论失败，跳过该条：${(e as Error).message}`);
    }
  }
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
    draft?: boolean;
    user?: { login: string; type?: string };
    head: { sha: string };
  };

  const fileConfig = loadRepoConfigFile();
  const config = resolveConfig(
    {
      language: core.getInput("language"),
      ignore_patterns: core.getInput("ignore_patterns"),
      custom_instructions: core.getInput("custom_instructions"),
      max_diff_chars: core.getInput("max_diff_chars"),
      max_body_chars: core.getInput("max_body_chars"),
      on_update: core.getInput("on_update"),
      keep_previous_comments: core.getInput("keep_previous_comments"),
      skip_draft: core.getInput("skip_draft"),
      ignore_bots: core.getInput("ignore_bots"),
      ignore_authors: core.getInput("ignore_authors"),
    },
    fileConfig
  );

  // 智能早退检查（草稿 PR、Bot PR、忽略作者）
  const skipCheck = shouldSkipReview({
    isDraft: pr.draft,
    skipDraft: config.skipDraft,
    author: pr.user,
    ignoreBots: config.ignoreBots,
    ignoreAuthors: config.ignoreAuthors,
    lang: config.language,
  });
  if (skipCheck.skip) {
    core.info(skipCheck.reason ?? "跳过评审");
    return;
  }

  const octokit = github.getOctokit(GITHUB_TOKEN);
  const repo = { owner: ctx.repo.owner, repo: ctx.repo.repo };

  const { diff, fileLines } = await getPrDiff(octokit, repo, pr.number, config);
  if (!diff || diff.trim().length === 0) {
    core.info("无有效代码变更需评审");
    return;
  }
  core.info(`评审 ${ctx.repo.owner}/${ctx.repo.repo} PR #${pr.number}，diff ${diff.length} 字符，模型 ${LLM_MODEL}`);

  const content = await callLlm(diff, config);
  const { summary, inlines, bodyItems } = parseReviews(content, fileLines);
  // 空结果也发布「未发现问题」并替换/更新旧评审，避免上一轮的意见残留误导
  const body = buildReviewBody({ summary, bodyItems, model: LLM_MODEL }, config.language, config.maxBodyChars);

  await postReview(octokit, repo, pr.number, pr.head.sha, body, inlines, config.onUpdate);
  core.info("评审已发布");
}

main().catch((e) => {
  core.setFailed(`评审失败：${(e as Error).message}`);
});

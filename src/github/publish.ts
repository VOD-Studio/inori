import * as core from "@actions/core";
import { errMsg } from "../core/errors";
import { REVIEW_MARKER, type InlineComment } from "../core/review";
import type { OnUpdate } from "../config";
import { deleteOldInlineComments, findOldReviewId, resolveOldInlineThreads } from "./history";
import type { OctokitInstance, RepoContext } from "./paginate";

// ── 评审发布 ──

/**
 * 发布评审（更新复用模式）：GitHub REST 无法删除已提交的 review，
 * 因此汇总 body 复用同一轮评审（updateReview 原地更新）。
 * inline 评论按 onUpdate 策略处理上一轮痕迹（replace 删除 / resolve
 * 折叠 / keep 保留），再逐条发新的（每条内嵌标记供下轮识别清理）。
 */
export async function postReview(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  headSha: string,
  body: string,
  inlines: InlineComment[],
  onUpdate: OnUpdate
): Promise<void> {
  if (onUpdate === "replace") {
    try {
      await deleteOldInlineComments(octokit, repo, prNumber);
    } catch (e) {
      core.warning(`清理旧 inline 评论失败，继续发布：${errMsg(e)}`);
    }
  } else if (onUpdate === "resolve") {
    try {
      await resolveOldInlineThreads(octokit, repo, prNumber);
    } catch (e) {
      core.warning(`解决旧 inline 评审线程失败，继续发布：${errMsg(e)}`);
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
    core.warning(`更新旧评审失败，改为新建：${errMsg(e)}`);
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
      core.warning(`inline 评论失败，跳过该条：${errMsg(e)}`);
    }
  }
}

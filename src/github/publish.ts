import * as core from '@actions/core'
import type { OnUpdate } from '../config'
import { errMsg } from '../core/errors'
import { type InlineComment, REVIEW_MARKER } from '../core/review'
import { deleteOldInlineComments, resolveOldInlineThreads, snapshotInlineComments } from './history'
import type { OctokitInstance, RepoContext } from './paginate'

export interface PublishResult {
  postedInlineCount: number
  failedInlineCount: number
}

// Leave room for continuation labels and markers below GitHub's 65,536-character limit.
const SUMMARY_CHUNK_SIZE = 60_000

function summaryParts(body: string): string[] {
  const parts: string[] = []
  let offset = 0
  do {
    let end = Math.min(offset + SUMMARY_CHUNK_SIZE, body.length)
    // Keep supplementary Unicode characters intact across review bodies.
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end -= 1
    parts.push(body.slice(offset, end))
    offset = end
  } while (offset < body.length)
  return parts
}

export async function postReview(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  headSha: string,
  body: string,
  inlines: InlineComment[],
  onUpdate: OnUpdate,
): Promise<PublishResult> {
  let oldCommentIds = new Set<number>()
  if (onUpdate !== 'keep') {
    try {
      oldCommentIds = await snapshotInlineComments(octokit, repo, prNumber)
    } catch (e) {
      core.warning(`读取历史 inline 评论失败，本轮保留历史：${errMsg(e)}`)
    }
  }

  const failed: InlineComment[] = []
  for (const ic of inlines) {
    try {
      await octokit.rest.pulls.createReviewComment({
        ...repo,
        pull_number: prNumber,
        body: `${ic.body}\n\n${REVIEW_MARKER}`,
        path: ic.path,
        line: ic.line,
        side: 'RIGHT',
        commit_id: headSha,
      })
      core.info(`inline 评论: ${ic.path}:${ic.line}`)
    } catch (e) {
      failed.push(ic)
      core.warning(`inline 评论失败，将完整内容保存在汇总：${errMsg(e)}`)
    }
  }

  const fallback = failed.length
    ? `\n\n### Inline delivery incomplete / 行内评论发布不完整\n\n${failed
        .map((ic) => `#### ${ic.path}:${ic.line}\n\n${ic.body}`)
        .join('\n\n')}`
    : ''
  const parts = summaryParts(`${body}${fallback}`)
  let actorId: number | undefined
  for (const [index, part] of parts.entries()) {
    const result = await octokit.rest.pulls.createReview({
      ...repo,
      pull_number: prNumber,
      body: `${parts.length > 1 ? `(${index + 1}/${parts.length})\n\n` : ''}${part}\n\n${REVIEW_MARKER}`,
      event: 'COMMENT',
      commit_id: headSha,
    })
    actorId = result.data.user?.id
  }

  // A write response identifies both App and PAT authors without guessing a bot login.
  if (onUpdate !== 'keep' && actorId === undefined) {
    core.warning('无法确认评审发布身份，本轮保留历史 inline 评论')
  }
  if (failed.length === 0 && actorId !== undefined && oldCommentIds.size > 0) {
    try {
      if (onUpdate === 'replace') {
        await deleteOldInlineComments(octokit, repo, prNumber, oldCommentIds, actorId)
      } else if (onUpdate === 'resolve') {
        await resolveOldInlineThreads(octokit, repo, prNumber, oldCommentIds, actorId)
      }
    } catch (e) {
      core.warning(`清理历史 inline 评论失败，新评审已保存：${errMsg(e)}`)
    }
  }
  return { postedInlineCount: inlines.length - failed.length, failedInlineCount: failed.length }
}

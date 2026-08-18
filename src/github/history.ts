import * as core from '@actions/core'
import { errMsg } from '../core/errors'
import { REVIEW_MARKER } from '../core/review'
import { type OctokitInstance, paginate, type RepoContext } from './paginate'

// ── 上一轮 inori 评审痕迹的识别与清理 ──

interface RawReviewComment {
  id: number
  body?: string | null
  in_reply_to_id?: number
}

interface RawReview {
  id: number
  body?: string | null
}

/**
 * 删除上一轮 inori 的 inline 评论（body 内嵌标记识别）。
 * 有人回复过的线程跳过，不破坏人工讨论。
 */
export async function deleteOldInlineComments(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<void> {
  const all = await paginate<RawReviewComment>((page) =>
    octokit.rest.pulls
      .listReviewComments({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data as RawReviewComment[]),
  )

  const replied = new Set(
    all.filter((c) => c.in_reply_to_id).map((c) => c.in_reply_to_id as number),
  )
  for (const c of all) {
    if (!c.body?.includes(REVIEW_MARKER) || c.in_reply_to_id || replied.has(c.id)) continue
    try {
      await octokit.rest.pulls.deleteReviewComment({ ...repo, comment_id: c.id })
    } catch (e) {
      core.warning(`删除旧 inline 评论 #${c.id} 失败：${errMsg(e)}`)
    }
  }
}

/**
 * 将上一轮 inori 创建且未被人工回复的 review threads 标记为 Resolved。
 * 旧意见折叠留痕，不堆叠未读红点。
 */
export async function resolveOldInlineThreads(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<void> {
  let cursor: string | null = null
  let hasNextPage = true

  while (hasNextPage) {
    const data = (await octokit.graphql(
      `
      query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 100) { nodes { id body } }
              }
            }
          }
        }
      }
    `,
      { owner: repo.owner, repo: repo.repo, prNumber, cursor },
    )) as {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            pageInfo?: { hasNextPage: boolean; endCursor: string | null }
            nodes?: {
              id: string
              isResolved: boolean
              comments?: { nodes?: { id: string; body: string }[] }
            }[]
          }
        }
      }
    }

    const threads = data.repository?.pullRequest?.reviewThreads?.nodes ?? []
    for (const thread of threads) {
      if (thread.isResolved) continue
      const comments = thread.comments?.nodes ?? []
      if (comments.length === 0) continue
      // 仅处理首条为 inori 且无人工回复（单条）的线程
      if (comments[0].body.includes(REVIEW_MARKER) && comments.length === 1) {
        try {
          await octokit.graphql(
            `
            mutation($threadId: ID!) {
              resolveReviewThread(input: { threadId: $threadId }) {
                thread { id isResolved }
              }
            }
          `,
            { threadId: thread.id },
          )
          core.info(`已将历史评审线程 ${thread.id} 标记为已解决 (Resolved)`)
        } catch (e) {
          core.warning(`标记评审线程 ${thread.id} 已解决失败：${errMsg(e)}`)
        }
      }
    }

    const pageInfo = data.repository?.pullRequest?.reviewThreads?.pageInfo
    hasNextPage = pageInfo?.hasNextPage ?? false
    cursor = pageInfo?.endCursor ?? null
  }
}

/** 找到最近一轮 inori 评审的 id（body 内嵌标记识别），无则返回 null */
export async function findOldReviewId(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<number | null> {
  const reviews = await paginate<RawReview>((page) =>
    octokit.rest.pulls
      .listReviews({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data as RawReview[]),
  )
  let target: number | null = null
  // 列表按提交时间升序，持续覆盖取最后一个命中的
  for (const rv of reviews) {
    if (rv.body?.includes(REVIEW_MARKER)) target = rv.id
  }
  return target
}

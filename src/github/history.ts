import * as core from '@actions/core'
import { errMsg } from '../core/errors'
import { REVIEW_MARKER } from '../core/review'
import { type OctokitInstance, paginate, type RepoContext } from './paginate'

interface RawReviewComment {
  id: number
  body?: string | null
  in_reply_to_id?: number
  user?: { id: number } | null
}

function listComments(octokit: OctokitInstance, repo: RepoContext, prNumber: number) {
  return paginate<RawReviewComment>((page) =>
    octokit.rest.pulls
      .listReviewComments({ ...repo, pull_number: prNumber, per_page: 100, page })
      .then((r) => r.data),
  )
}

export async function snapshotInlineComments(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<Set<number>> {
  const comments = await listComments(octokit, repo, prNumber)
  return new Set(comments.filter((c) => c.body?.includes(REVIEW_MARKER)).map((c) => c.id))
}

async function eligibleCommentIds(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  oldCommentIds: ReadonlySet<number>,
  actorId: number,
): Promise<Set<number>> {
  // Refresh replies after publishing, but never expand the pre-publication ID snapshot.
  const all = await listComments(octokit, repo, prNumber)
  const replied = new Set(all.flatMap((c) => (c.in_reply_to_id ? [c.in_reply_to_id] : [])))
  return new Set(
    all
      .filter(
        (c) =>
          oldCommentIds.has(c.id) &&
          c.user?.id === actorId &&
          c.body?.includes(REVIEW_MARKER) &&
          !c.in_reply_to_id &&
          !replied.has(c.id),
      )
      .map((c) => c.id),
  )
}

export async function deleteOldInlineComments(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  oldCommentIds: ReadonlySet<number>,
  actorId: number,
): Promise<void> {
  const eligible = await eligibleCommentIds(octokit, repo, prNumber, oldCommentIds, actorId)
  for (const id of eligible) {
    try {
      await octokit.rest.pulls.deleteReviewComment({ ...repo, comment_id: id })
    } catch (e) {
      core.warning(`删除旧 inline 评论 #${id} 失败：${errMsg(e)}`)
    }
  }
}

export async function resolveOldInlineThreads(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
  oldCommentIds: ReadonlySet<number>,
  actorId: number,
): Promise<void> {
  const eligible = await eligibleCommentIds(octokit, repo, prNumber, oldCommentIds, actorId)
  if (eligible.size === 0) return
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
                comments(first: 2) { nodes { databaseId } }
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
              comments?: { nodes?: { databaseId: number | null }[] }
            }[]
          }
        }
      }
    }

    for (const thread of data.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
      const comments = thread.comments?.nodes ?? []
      const id = comments[0]?.databaseId
      if (thread.isResolved || comments.length !== 1 || id == null || !eligible.has(id)) continue
      try {
        await octokit.graphql(
          `mutation($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
              thread { id isResolved }
            }
          }`,
          { threadId: thread.id },
        )
      } catch (e) {
        core.warning(`标记评审线程 ${thread.id} 已解决失败：${errMsg(e)}`)
      }
    }

    const pageInfo = data.repository?.pullRequest?.reviewThreads?.pageInfo
    hasNextPage = pageInfo?.hasNextPage ?? false
    cursor = pageInfo?.endCursor ?? null
  }
}

import { describe, expect, it, vi } from 'vitest'
import { REVIEW_MARKER } from '../../src/core/review'
import { deleteOldInlineComments, resolveOldInlineThreads } from '../../src/github/history'
import type { OctokitInstance } from '../../src/github/paginate'

vi.mock('@actions/core', () => ({ warning: vi.fn(), info: vi.fn() }))

const repo = { owner: 'owner', repo: 'repo' }
const comment = (id: number, actorId = 42) => ({ id, body: REVIEW_MARKER, user: { id: actorId } })
function client(comments: object[]) {
  const pulls = {
    listReviewComments: vi.fn().mockResolvedValue({ data: comments }),
    deleteReviewComment: vi.fn().mockResolvedValue({}),
  }
  const graphql = vi.fn().mockResolvedValue({})
  return { pulls, graphql, octokit: { rest: { pulls }, graphql } as unknown as OctokitInstance }
}

describe('history ownership', () => {
  it('protects copied markers, replies, discussion roots and comments outside the snapshot', async () => {
    const { pulls, octokit } = client([
      comment(1),
      comment(2, 9),
      comment(3),
      comment(4),
      { ...comment(5), in_reply_to_id: 3 },
      { ...comment(6), body: 'No marker' },
      { ...comment(7), user: null },
    ])
    await deleteOldInlineComments(octokit, repo, 1, new Set([1, 2, 3, 5, 6, 7]), 42)
    expect(pulls.deleteReviewComment).toHaveBeenCalledExactlyOnceWith({ ...repo, comment_id: 1 })
  })

  it('supports a PAT author without relying on a bot login', async () => {
    const { pulls, octokit } = client([comment(1, 123)])
    await deleteOldInlineComments(octokit, repo, 1, new Set([1]), 123)
    expect(pulls.deleteReviewComment).toHaveBeenCalledTimes(1)
  })

  it('resolves only eligible old threads and protects replies added after the REST read', async () => {
    const { graphql, octokit } = client([comment(1), comment(2, 9), comment(3), comment(4)])
    const thread = (id: string, ids: number[]) => ({
      id,
      isResolved: false,
      comments: { nodes: ids.map((databaseId) => ({ databaseId })) },
    })
    graphql.mockResolvedValueOnce({
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              thread('old', [1]),
              thread('spoof', [2]),
              thread('replied', [3, 6]),
              thread('new', [4]),
            ],
          },
        },
      },
    })
    await resolveOldInlineThreads(octokit, repo, 1, new Set([1, 2, 3]), 42)
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[1][1]).toEqual({ threadId: 'old' })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { REVIEW_MARKER } from '../../src/core/review'
import type { OctokitInstance } from '../../src/github/paginate'
import { postReview } from '../../src/github/publish'

vi.mock('@actions/core', () => ({ warning: vi.fn(), info: vi.fn() }))

const repo = { owner: 'owner', repo: 'repo' }
const inline = { path: 'src/index.ts', line: 12, body: 'Concrete finding and remediation' }
const oldComment = { id: 1, body: REVIEW_MARKER, user: { id: 42 } }

function client() {
  const pulls = {
    listReviewComments: vi.fn().mockResolvedValue({ data: [oldComment] }),
    createReview: vi.fn().mockResolvedValue({ data: { user: { id: 42 } } }),
    createReviewComment: vi.fn().mockResolvedValue({ data: {} }),
    deleteReviewComment: vi.fn().mockResolvedValue({}),
  }
  const graphql = vi.fn()
  return { pulls, graphql, octokit: { rest: { pulls }, graphql } as unknown as OctokitInstance }
}

describe('postReview', () => {
  it('publishes all results before deleting only preexisting comments', async () => {
    const { pulls, octokit } = client()
    pulls.listReviewComments.mockResolvedValueOnce({ data: [oldComment] }).mockResolvedValueOnce({
      data: [oldComment, { ...oldComment, id: 2 }],
    })
    expect(await postReview(octokit, repo, 1, 'sha', 'Summary', [inline], 'replace')).toEqual({
      postedInlineCount: 1,
      failedInlineCount: 0,
    })
    expect(pulls.deleteReviewComment).toHaveBeenCalledExactlyOnceWith({ ...repo, comment_id: 1 })
    expect(pulls.createReview.mock.invocationCallOrder[0]).toBeLessThan(
      pulls.deleteReviewComment.mock.invocationCallOrder[0],
    )
    expect(pulls.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ commit_id: 'sha', side: 'RIGHT' }),
    )
  })

  it('stores failed inline findings in the summary and preserves history', async () => {
    const { pulls, octokit } = client()
    pulls.createReviewComment.mockRejectedValue(new Error('invalid line'))
    expect(await postReview(octokit, repo, 1, 'sha', 'Summary', [inline], 'replace')).toEqual({
      postedInlineCount: 0,
      failedInlineCount: 1,
    })
    const body = pulls.createReview.mock.calls[0][0].body
    expect(body).toContain('src/index.ts:12')
    expect(body).toContain(inline.body)
    expect(body).toContain('发布不完整')
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('throws when even the fallback cannot be persisted, without cleaning history or retrying', async () => {
    const { pulls, octokit } = client()
    pulls.createReviewComment.mockRejectedValue(new Error('timeout'))
    pulls.createReview.mockRejectedValue(new Error('forbidden'))
    await expect(
      postReview(octokit, repo, 1, 'sha', 'Summary', [inline], 'replace'),
    ).rejects.toThrow('forbidden')
    expect(pulls.createReview).toHaveBeenCalledTimes(1)
    expect(pulls.createReviewComment).toHaveBeenCalledTimes(1)
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('splits oversized fallback without losing finding text or splitting surrogate pairs', async () => {
    const { pulls, octokit } = client()
    pulls.createReviewComment.mockRejectedValue(new Error('too large'))
    const text = '💡'.repeat(70_000)
    await postReview(octokit, repo, 1, 'sha', 'Summary', [{ ...inline, body: text }], 'replace')
    const bodies = pulls.createReview.mock.calls.map(([arg]) => arg.body as string)
    expect(bodies.length).toBeGreaterThan(1)
    expect(bodies.every((body) => body.length <= 65_536 && body.isWellFormed())).toBe(true)
    expect(bodies.join('').match(/💡/gu)).toHaveLength(70_000)
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('preserves history if a later summary chunk fails', async () => {
    const { pulls, octokit } = client()
    pulls.createReview
      .mockResolvedValueOnce({ data: { user: { id: 42 } } })
      .mockRejectedValueOnce(new Error('rate limit'))
    await expect(
      postReview(octokit, repo, 1, 'sha', 'x'.repeat(70_000), [], 'replace'),
    ).rejects.toThrow('rate limit')
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('publishes without cleanup when identity is unavailable', async () => {
    const { pulls, octokit } = client()
    pulls.createReview.mockResolvedValue({ data: { user: null } })
    await postReview(octokit, repo, 1, 'sha', 'Summary', [], 'replace')
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('publishes without cleanup when reading history fails', async () => {
    const { pulls, octokit } = client()
    pulls.listReviewComments.mockRejectedValue(new Error('unavailable'))
    await postReview(octokit, repo, 1, 'sha', 'Summary', [], 'replace')
    expect(pulls.createReview).toHaveBeenCalledTimes(1)
    expect(pulls.deleteReviewComment).not.toHaveBeenCalled()
  })

  it('does not inspect history for keep mode', async () => {
    const { pulls, octokit } = client()
    await postReview(octokit, repo, 1, 'sha', 'Summary', [], 'keep')
    expect(pulls.listReviewComments).not.toHaveBeenCalled()
  })
})

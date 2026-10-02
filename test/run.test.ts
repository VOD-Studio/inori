import * as core from '@actions/core'
import * as github from '@actions/github'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postReview } from '../src/github/publish'
import { callLlm } from '../src/llm'
import { run } from '../src/run'

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  summary: {
    addHeading: vi.fn().mockReturnThis(),
    addTable: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@actions/github', () => ({ context: {}, getOctokit: vi.fn() }))
vi.mock('../src/llm', () => ({
  readLlmSettings: vi.fn().mockReturnValue({ model: 'test-model' }),
  callLlm: vi.fn(),
}))
vi.mock('../src/github/publish', () => ({ postReview: vi.fn() }))

const get = vi.fn()
const getContent = vi.fn()
const listFiles = vi.fn()
const listCommits = vi.fn()
const snapshot = { data: { head: { sha: 'head' }, base: { sha: 'base' }, changed_files: 1 } }
const context = {
  payload: {
    pull_request: {
      number: 1,
      head: { sha: 'head' },
      base: { sha: 'base' },
      user: { login: 'human' },
    },
  },
  repo: { owner: 'owner', repo: 'repo' },
} as unknown as typeof github.context
const file = { filename: 'src/a.ts', patch: '@@ -0,0 +1 @@\n+const a = 1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(core.getInput).mockImplementation((name) => (name === 'github_token' ? 'token' : ''))
  vi.mocked(github.getOctokit).mockReturnValue({
    rest: { pulls: { get, listFiles, listCommits }, repos: { getContent } },
  } as never)
  get.mockReset().mockResolvedValue(snapshot)
  getContent.mockReset().mockRejectedValue({ status: 404 })
  listFiles.mockReset().mockResolvedValue({ data: [file] })
  listCommits.mockReset().mockResolvedValue({ data: [{ commit: { message: 'fix: bug' } }] })
  vi.mocked(callLlm).mockResolvedValue('{"summary":"Looks good","reviews":[]}')
  vi.mocked(postReview).mockResolvedValue({ postedInlineCount: 0, failedInlineCount: 0 })
})

describe('review orchestration', () => {
  it('publishes a valid review and exposes outputs plus coverage', async () => {
    const result = await run(context)
    expect(result).toMatchObject({
      status: 'completed',
      head_sha: 'head',
      reviewed_files: 1,
      omitted_files: 0,
      findings_count: 0,
    })
    expect(postReview).toHaveBeenCalledOnce()
    expect(vi.mocked(postReview).mock.calls[0][4]).toContain('head')
    expect(core.setOutput).toHaveBeenCalledWith('status', 'completed')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: 'base' }))
    expect(get).toHaveBeenCalledTimes(4)
    expect(listCommits).not.toHaveBeenCalled()
  })

  it.each(['{}', 'null', '<think>truncated'])(
    'invalid model result preserves old review: %s',
    async (content) => {
      vi.mocked(callLlm).mockResolvedValue(content)
      expect((await run(context)).status).toBe('failed')
      expect(postReview).not.toHaveBeenCalled()
      expect(core.setFailed).toHaveBeenCalled()
    },
  )

  it('model failure is observable without leaking response text', async () => {
    vi.mocked(callLlm).mockRejectedValue(new Error('private-model-response'))
    expect(await run(context)).toMatchObject({ status: 'failed', reviewed_files: 0 })
    expect(postReview).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(core.setOutput).mock.calls)).not.toContain(
      'private-model-response',
    )
  })

  it.each([1, 2, 3, 4])('stale snapshot at check %s cannot publish', async (check) => {
    for (let i = 1; i < check; i++) get.mockResolvedValueOnce(snapshot)
    get.mockResolvedValueOnce({ data: { ...snapshot.data, head: { sha: 'new-head' } } })
    expect((await run(context)).status).toBe('stale')
    expect(postReview).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('base changes also stop publication', async () => {
    get.mockResolvedValueOnce({ data: { ...snapshot.data, base: { sha: 'new-base' } } })
    expect((await run(context)).status).toBe('stale')
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('base configuration read failure cannot fall back to workspace', async () => {
    getContent.mockRejectedValue({ status: 403 })
    expect((await run(context)).status).toBe('failed')
    expect(callLlm).not.toHaveBeenCalled()
    expect(postReview).not.toHaveBeenCalled()
  })

  it('missing base SHA fails before API or model calls', async () => {
    const missingBase = {
      ...context,
      payload: { pull_request: { number: 1, head: { sha: 'head' } } },
    }
    expect((await run(missingBase)).status).toBe('failed')
    expect(get).not.toHaveBeenCalled()
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('draft skips with no LLM or publication', async () => {
    const draft = {
      ...context,
      payload: { pull_request: { ...context.payload.pull_request, draft: true } },
    }
    expect((await run(draft)).status).toBe('skipped')
    expect(callLlm).not.toHaveBeenCalled()
    expect(postReview).not.toHaveBeenCalled()
  })

  it('unavailable patches and API omissions are partial', async () => {
    get.mockResolvedValue({ data: { ...snapshot.data, changed_files: 3 } })
    listFiles.mockResolvedValue({ data: [file, { filename: 'image.png' }] })
    expect(await run(context)).toMatchObject({
      status: 'partial',
      reviewed_files: 1,
      omitted_files: 2,
    })
    expect(vi.mocked(postReview).mock.calls[0][6]).toBe('keep')
  })

  it('no available patches is partial without a false clean review', async () => {
    listFiles.mockResolvedValue({ data: [{ filename: 'image.png' }] })
    expect(await run(context)).toMatchObject({
      status: 'partial',
      reviewed_files: 0,
      omitted_files: 1,
    })
    expect(callLlm).not.toHaveBeenCalled()
    expect(postReview).not.toHaveBeenCalled()
  })

  it('all ignored files skip without a model request', async () => {
    listFiles.mockResolvedValue({ data: [{ filename: 'pnpm-lock.yaml', patch: file.patch }] })
    expect((await run(context)).status).toBe('skipped')
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('body budget failure reports its own stage and retains history', async () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      if (name === 'github_token') return 'token'
      return name === 'max_body_chars' ? '1' : ''
    })
    expect(await run(context)).toMatchObject({
      status: 'failed',
      reviewed_files: 1,
      reason: 'Unable to build the complete review body within the configured size limit',
    })
    expect(postReview).not.toHaveBeenCalled()
  })

  it('inline fallback becomes partial and publisher failure becomes failed', async () => {
    vi.mocked(postReview).mockResolvedValue({ postedInlineCount: 0, failedInlineCount: 1 })
    expect((await run(context)).status).toBe('partial')
    vi.mocked(postReview).mockRejectedValue(new Error('request body'))
    expect(await run(context)).toMatchObject({ status: 'failed', reviewed_files: 1 })
    expect(core.setFailed).toHaveBeenCalled()
  })
})

import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postReview } from '../src/github/publish'
import { run } from '../src/run'

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setSecret: vi.fn(),
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
vi.mock('../src/github/publish', () => ({ postReview: vi.fn() }))

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
const inputs: Record<string, string> = {}
const get = vi.fn()
const listFiles = vi.fn()

function arrangeFiles(count: number): void {
  listFiles.mockResolvedValue({
    data: Array.from({ length: count }, (_, index) => ({
      filename: `src/${String.fromCharCode(97 + index)}.ts`,
      patch: '@@ -0,0 +1 @@\n+const a = 1',
    })),
  })
  get.mockResolvedValue({
    data: { head: { sha: 'head' }, base: { sha: 'base' }, changed_files: count },
  })
}

function response(content = '{"summary":"done","reviews":[]}'): Response {
  return Response.json({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(inputs)) delete inputs[key]
  Object.assign(inputs, {
    github_token: 'test-token',
    llm_endpoint: 'https://llm.example/v1',
    llm_api_key: 'test-key',
    batch_diff_chars: '60',
    max_requests: '4',
    review_concurrency: '1',
  })
  vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? '')
  vi.mocked(github.getOctokit).mockReturnValue({
    rest: {
      pulls: { get, listFiles, listCommits: vi.fn() },
      repos: { getContent: vi.fn().mockRejectedValue({ status: 404 }) },
    },
  } as never)
  vi.mocked(postReview).mockResolvedValue({ postedInlineCount: 0, failedInlineCount: 0 })
  arrangeFiles(3)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('real run and LLM budget integration', () => {
  it('marks an attempted 500 as failed and later batches unstarted with no retry', async () => {
    inputs.max_requests = '1'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('private model error', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await run(context)).toMatchObject({
      status: 'failed',
      reviewed_files: 0,
      omitted_files: 3,
      requests_used: 1,
      batches_completed: 0,
      batches_failed: 1,
      batches_unstarted: 2,
      total_tokens: '',
      usage_complete: false,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(postReview).not.toHaveBeenCalled()
    expect(core.setFailed).toHaveBeenCalledOnce()
    expect(core.warning).toHaveBeenCalledOnce()
    expect(core.warning).toHaveBeenCalledWith(
      'Review batch 1 failed (LLM request budget exhausted)',
    )
    expect(JSON.stringify(vi.mocked(core.setOutput).mock.calls)).not.toContain(
      'private model error',
    )
  })

  it('publishes valid batches once, retains history and accounts for invalid-review usage', async () => {
    arrangeFiles(2)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await run(context)).toMatchObject({
      status: 'partial',
      reviewed_files: 1,
      omitted_files: 1,
      requests_used: 2,
      batches_completed: 1,
      batches_failed: 1,
      batches_unstarted: 0,
      prompt_tokens: 20,
      completion_tokens: 4,
      total_tokens: 24,
      usage_complete: true,
    })
    expect(postReview).toHaveBeenCalledOnce()
    expect(vi.mocked(postReview).mock.calls[0][6]).toBe('keep')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('shares a hard request ceiling across real concurrent LLM calls', async () => {
    inputs.review_concurrency = '2'
    inputs.max_requests = '2'
    const first = Promise.withResolvers<Response>()
    const second = Promise.withResolvers<Response>()
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetchMock)
    const result = run(context)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(postReview).not.toHaveBeenCalled()
    second.resolve(response('{"summary":"second","reviews":[]}'))
    first.resolve(response('{"summary":"first","reviews":[]}'))
    expect(await result).toMatchObject({
      status: 'partial',
      reviewed_files: 2,
      omitted_files: 1,
      requests_used: 2,
      batches_completed: 2,
      batches_failed: 0,
      batches_unstarted: 1,
      total_tokens: 24,
      usage_complete: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(postReview).toHaveBeenCalledOnce()
    const body = vi.mocked(postReview).mock.calls[0][4]
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'))
    expect(vi.mocked(postReview).mock.calls[0][6]).toBe('keep')
  })
})

import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../../src/config'
import {
  BudgetExceededError,
  callLlm,
  createLlmRequestBudget,
  type LlmSettings,
} from '../../src/llm'

const config = {
  language: 'zh',
  customInstructions: '',
  codingPlan: false,
} as ResolvedConfig
const settings: LlmSettings = {
  endpoint: 'https://llm.example/v1',
  model: 'model',
  apiKey: 'private-key',
  timeoutMs: 1000,
  maxRetries: 2,
}
const content = '{"summary":"done","reviews":[]}'
const success = () => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })

beforeEach(() => {
  vi.spyOn(core, 'warning').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('callLlm response validation', () => {
  it('returns complete content and sends the selected credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(success())
    vi.stubGlobal('fetch', fetchMock)
    expect(await callLlm('diff', config, settings)).toBe(content)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer private-key' }),
      }),
    )
  })

  it('supports compatible endpoints that omit finish_reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ choices: [{ message: { content: ` ${content} ` } }] })),
    )
    expect(await callLlm('diff', config, settings)).toBe(content)
  })

  it.each(['length', 'content_filter', 'tool_calls', null, 1])(
    'rejects incomplete finish_reason %j',
    async (reason) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content }, finish_reason: reason }] }),
        )
      vi.stubGlobal('fetch', fetchMock)
      await expect(callLlm('diff', config, settings)).rejects.toThrow(/未正常完成/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    null,
    [],
    {},
    { choices: null },
    { choices: [] },
    { choices: [null] },
    { choices: [{ message: null }] },
    { choices: [{ message: { content: ' ' } }] },
    { choices: [{ message: { content: 123 } }] },
    { choices: [{ message: { content: {} } }] },
  ])('rejects invalid data without printing it: %j', async (data) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callLlm('diff', config, settings)).rejects.toThrow(/LLM 响应/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not leak invalid JSON response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private response')))
    await expect(callLlm('diff', config, settings)).rejects.toThrow('LLM 响应不是有效 JSON')
  })

  it('does not leak HTTP response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private response', { status: 401 })),
    )
    await expect(callLlm('diff', config, settings)).rejects.toThrow('LLM HTTP 401: 端点请求失败')
  })
})

describe('callLlm retry behavior', () => {
  it('retries a 400 once without response_format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    expect(await callLlm('diff', config, settings)).toBe(content)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[1]).not.toHaveProperty('response_format')
  })

  it('does not loop on repeated 400 responses', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('', { status: 400 })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callLlm('diff', config, settings)).rejects.toThrow(/HTTP 400/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500, 503])('retries HTTP %i up to maxRetries', async (status) => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('private response', { status })))
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(callLlm('diff', config, settings)).rejects.toThrow(`HTTP ${status}`)
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(vi.mocked(core.warning).mock.calls.flat().join(' ')).not.toContain('private response')
  })

  it.each([
    new TypeError('private network detail'),
    new DOMException('private timeout', 'TimeoutError'),
  ])('retries transient transport failure: %s', async (error) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    const result = callLlm('diff', config, settings)
    await vi.runAllTimersAsync()
    expect(await result).toBe(content)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.mocked(core.warning).mock.calls.flat().join(' ')).not.toContain('private')
  })
})

describe('shared LLM request budget', () => {
  it('claims synchronously across concurrent calls', async () => {
    const { promise, resolve } = Promise.withResolvers<Response>()
    const fetchMock = vi.fn().mockReturnValue(promise)
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(1)
    const first = callLlm('first', config, settings, budget)
    await expect(callLlm('second', config, settings, budget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    )
    expect(budget.used).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolve(success())
    expect(await first).toBe(content)
  })

  it('does not fetch when already exhausted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(1)
    budget.used = 1
    await expect(callLlm('diff', config, settings, budget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(budget.durationMs).toBe(0)
  })

  it('counts the response_format fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(2)
    expect(await callLlm('diff', config, settings, budget)).toBe(content)
    expect(budget.used).toBe(2)
  })

  it('refuses response_format fallback after exhausting the budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(1)
    await expect(callLlm('diff', config, settings, budget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(core.warning).not.toHaveBeenCalled()
  })

  it.each([
    new Response('', { status: 429 }),
    new Response('', { status: 503 }),
    new TypeError('private detail'),
    new DOMException('private timeout', 'TimeoutError'),
  ])('does not back off after the final allowed request: %s', async (result) => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
      )
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(1)
    await expect(callLlm('diff', config, settings, budget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(budget.used).toBe(1)
    expect(core.warning).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts retry failures, fallback and success in the same budget', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('private detail'))
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)
    const budget = createLlmRequestBudget(3)
    const result = callLlm('diff', config, settings, budget)
    await vi.runAllTimersAsync()
    expect(await result).toBe(content)
    expect(budget.used).toBe(3)
  })

  it('records elapsed request time for failures without counting backoff', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(145)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('private detail')))
    const budget = createLlmRequestBudget(1)
    await expect(callLlm('diff', config, settings, budget)).rejects.toBeInstanceOf(
      BudgetExceededError,
    )
    expect(budget.durationMs).toBe(45)
    expect(budget.usage).toBeNull()
    expect(budget.usageRequests).toBe(0)
  })
})

describe('LLM reported token usage', () => {
  function responseWithUsage(usage: unknown): Response {
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage })
  }

  it('accumulates valid usage including zero tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            responseWithUsage({ prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 }),
          ),
        ),
    )
    const budget = createLlmRequestBudget(2)
    await Promise.all([
      callLlm('one', config, settings, budget),
      callLlm('two', config, settings, budget),
    ])
    expect(budget.usage).toEqual({ promptTokens: 20, completionTokens: 0, totalTokens: 20 })
    expect(budget.usageRequests).toBe(2)
  })

  it('keeps absent usage unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(success()))
    const budget = createLlmRequestBudget(1)
    expect(await callLlm('diff', config, settings, budget)).toBe(content)
    expect(budget.usage).toBeNull()
    expect(budget.usageRequests).toBe(0)
  })

  it.each([
    null,
    [],
    {},
    { prompt_tokens: 10, completion_tokens: 2 },
    { prompt_tokens: '10', completion_tokens: 2, total_tokens: 12 },
    { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
    { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 2, total_tokens: 2 },
    { prompt_tokens: {}, completion_tokens: 2, total_tokens: 2 },
  ])('ignores invalid usage without rejecting usable content: %j', async (usage) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithUsage(usage)))
    const budget = createLlmRequestBudget(1)
    expect(await callLlm('diff', config, settings, budget)).toBe(content)
    expect(budget.usage).toBeNull()
    expect(budget.usageRequests).toBe(0)
  })

  it('distinguishes partial reported usage from complete usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          responseWithUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
        )
        .mockResolvedValueOnce(success()),
    )
    const budget = createLlmRequestBudget(2)
    await callLlm('one', config, settings, budget)
    await callLlm('two', config, settings, budget)
    expect(budget.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
    expect(budget.usageRequests).toBe(1)
    expect(budget.used).toBe(2)
  })

  it('records usage before rejecting invalid completion content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: null }, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      ),
    )
    const budget = createLlmRequestBudget(1)
    await expect(callLlm('diff', config, settings, budget)).rejects.toThrow(/未正常完成/)
    expect(budget.usageRequests).toBe(1)
    expect(budget.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
  })

  it('does not accumulate beyond safe integer precision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          responseWithUsage({
            prompt_tokens: Number.MAX_SAFE_INTEGER,
            completion_tokens: 0,
            total_tokens: Number.MAX_SAFE_INTEGER,
          }),
        ),
      ),
    )
    const budget = createLlmRequestBudget(2)
    await callLlm('one', config, settings, budget)
    await callLlm('two', config, settings, budget)
    expect(budget.usageRequests).toBe(1)
    expect(budget.usage?.totalTokens).toBe(Number.MAX_SAFE_INTEGER)
  })
})

import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../../src/config'
import { callLlm, type LlmSettings } from '../../src/llm'

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

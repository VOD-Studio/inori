import { describe, expect, it, vi } from 'vitest'
import { loadBaseConfig } from '../../src/github/configSource'
import type { OctokitInstance } from '../../src/github/paginate'

function client(getContent: ReturnType<typeof vi.fn>): OctokitInstance {
  return { rest: { repos: { getContent } } } as unknown as OctokitInstance
}
const repo = { owner: 'owner', repo: 'repo' }
const encoded = (text: string) => ({
  data: { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64') },
})

describe('trusted base configuration', () => {
  it('requests the fixed base SHA and parses configuration', async () => {
    const getContent = vi.fn().mockResolvedValue(encoded('language: en'))
    expect(await loadBaseConfig(client(getContent), repo, 'base-sha')).toEqual({ language: 'en' })
    expect(getContent).toHaveBeenCalledWith({ ...repo, path: '.github/inori.yml', ref: 'base-sha' })
  })

  it('tries yaml only when yml does not exist', async () => {
    const getContent = vi
      .fn()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValue(encoded('skip_draft: false'))
    expect(await loadBaseConfig(client(getContent), repo, 'base')).toEqual({ skip_draft: false })
    expect(getContent).toHaveBeenLastCalledWith({
      ...repo,
      path: '.github/inori.yaml',
      ref: 'base',
    })
  })

  it('uses defaults only when neither file exists', async () => {
    const getContent = vi.fn().mockRejectedValue({ status: 404 })
    expect(await loadBaseConfig(client(getContent), repo, 'base')).toEqual({})
    expect(getContent).toHaveBeenCalledTimes(2)
  })

  it('does not fall back on API errors or malformed configuration', async () => {
    const getContent = vi.fn().mockRejectedValue({ status: 403 })
    await expect(loadBaseConfig(client(getContent), repo, 'base')).rejects.toEqual({ status: 403 })
    expect(getContent).toHaveBeenCalledTimes(1)
    getContent.mockResolvedValue(encoded('max_diff_chars: -2'))
    await expect(loadBaseConfig(client(getContent), repo, 'base')).rejects.toThrow('max_diff_chars')
  })

  it('rejects missing base SHA and non-file content', async () => {
    const getContent = vi.fn().mockResolvedValue({ data: [] })
    await expect(loadBaseConfig(client(getContent), repo, '')).rejects.toThrow('base SHA')
    expect(getContent).not.toHaveBeenCalled()
    await expect(loadBaseConfig(client(getContent), repo, 'base')).rejects.toThrow('Cannot read')
  })
})

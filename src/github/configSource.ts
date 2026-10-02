import { parseConfigFile } from '../config'
import type { InoriConfig } from '../config/types'
import type { OctokitInstance, RepoContext } from './paginate'

export interface PrSnapshot {
  headSha: string
  baseSha: string
  changedFiles: number
}

export async function readPrSnapshot(
  octokit: OctokitInstance,
  repo: RepoContext,
  prNumber: number,
): Promise<PrSnapshot> {
  const { data } = await octokit.rest.pulls.get({ ...repo, pull_number: prNumber })
  return { headSha: data.head.sha, baseSha: data.base.sha, changedFiles: data.changed_files }
}

export async function loadBaseConfig(
  octokit: OctokitInstance,
  repo: RepoContext,
  baseSha: string,
): Promise<InoriConfig> {
  if (!baseSha) throw new Error('Missing PR base SHA; cannot load trusted configuration')
  for (const name of ['inori.yml', 'inori.yaml']) {
    let data: unknown
    try {
      const response = await octokit.rest.repos.getContent({
        ...repo,
        path: `.github/${name}`,
        ref: baseSha,
      })
      data = response.data
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) continue
      throw error
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !('type' in data) ||
      data.type !== 'file' ||
      !('encoding' in data) ||
      data.encoding !== 'base64' ||
      !('content' in data) ||
      typeof data.content !== 'string'
    ) {
      throw new Error(`Cannot read trusted configuration: .github/${name}`)
    }
    return parseConfigFile(Buffer.from(data.content, 'base64').toString('utf8'))
  }
  return {}
}

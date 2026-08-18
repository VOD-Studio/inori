import type { GitHub } from '@actions/github/lib/utils'

// ── GitHub IO 公共类型与分页工具 ──

/** getOctokit 返回的实例类型，带 rest API 与 graphql 能力 */
export type OctokitInstance = InstanceType<typeof GitHub>

/** 仓库定位（owner/repo 对） */
export interface RepoContext {
  owner: string
  repo: string
}

const PAGE_SIZE = 100

/**
 * 逐页拉取直到不满一页（GitHub API 单页上限 100）。
 * fetchPage 负责发起请求并把当页响应映射为条目数组。
 */
export async function paginate<T>(fetchPage: (page: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = []
  let page = 1
  let items: T[] = []
  do {
    items = await fetchPage(page)
    all.push(...items)
    page += 1
  } while (items.length === PAGE_SIZE)
  return all
}

import { buildDiffFromFiles, listPrCommitSubjects, listPrFiles } from './diffSource'
import { deleteOldInlineComments, resolveOldInlineThreads } from './history'
import type { OctokitInstance, RepoContext } from './paginate'
import { paginate } from './paginate'
import { postReview } from './publish'

// ── GitHub IO 层对外接口 ──

export type { OctokitInstance, RepoContext }
export {
  buildDiffFromFiles,
  deleteOldInlineComments,
  listPrCommitSubjects,
  listPrFiles,
  paginate,
  postReview,
  resolveOldInlineThreads,
}

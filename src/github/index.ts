import { getPrDiff } from "./diffSource";
import { deleteOldInlineComments, findOldReviewId, resolveOldInlineThreads } from "./history";
import { paginate } from "./paginate";
import type { OctokitInstance, RepoContext } from "./paginate";
import { postReview } from "./publish";

// ── GitHub IO 层对外接口 ──

export { getPrDiff, postReview, deleteOldInlineComments, resolveOldInlineThreads, findOldReviewId, paginate };
export type { OctokitInstance, RepoContext };
